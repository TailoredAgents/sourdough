import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { STRIPE_TAX_CODES } from "@/lib/stripe-tax";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { getSiteUrl } from "@/lib/utils";
import { getBreadClubTaxStatus } from "./config";

type PlanRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  price_cents: number;
  active: boolean;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  stripe_price_cents: number | null;
  stripe_lookup_key: string;
};

type DeliveryPriceRow = {
  id: string;
  band_key: string;
  label: string;
  price_cents: number;
  active: boolean;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  stripe_price_cents: number | null;
  stripe_lookup_key: string;
};

export const BREAD_CLUB_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.expired",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.upcoming",
  "customer.subscription.updated",
  "customer.subscription.deleted",
] satisfies Stripe.WebhookEndpointCreateParams.EnabledEvent[];

function isCurrentFourWeekPrice(
  price: Stripe.Price,
  productId: string,
  amountCents: number,
) {
  const priceProductId =
    typeof price.product === "string" ? price.product : price.product.id;
  return (
    priceProductId === productId &&
    price.active &&
    price.currency === "usd" &&
    price.unit_amount === amountCents &&
    price.tax_behavior === "exclusive" &&
    price.recurring?.interval === "week" &&
    price.recurring.interval_count === 4
  );
}

async function findProduct(input: {
  savedId: string | null;
  metadataKey: string;
  metadataValue: string;
}) {
  const stripe = getStripe();
  if (!stripe) throw new Error("STRIPE_SECRET_KEY is not configured.");

  if (input.savedId) {
    try {
      const product = await stripe.products.retrieve(input.savedId);
      if (!product.deleted) return product;
    } catch {
      // Fall through to the stable metadata lookup.
    }
  }

  const result = await stripe.products.search({
    query: `metadata['${input.metadataKey}']:'${input.metadataValue}'`,
    limit: 1,
  });
  return result.data[0] ?? null;
}

async function ensureProduct(input: {
  savedId: string | null;
  name: string;
  description: string;
  taxCode: string;
  metadata: Record<string, string>;
}) {
  const stripe = getStripe();
  if (!stripe) throw new Error("STRIPE_SECRET_KEY is not configured.");

  const metadataEntry = Object.entries(input.metadata)[0];
  const existing = await findProduct({
    savedId: input.savedId,
    metadataKey: metadataEntry[0],
    metadataValue: metadataEntry[1],
  });

  if (existing) {
    return stripe.products.update(existing.id, {
      active: true,
      name: input.name,
      description: input.description,
      tax_code: input.taxCode,
      metadata: input.metadata,
    });
  }

  return stripe.products.create({
    active: true,
    name: input.name,
    description: input.description,
    tax_code: input.taxCode,
    metadata: input.metadata,
  });
}

async function ensureRecurringPrice(input: {
  productId: string;
  amountCents: number;
  lookupKey: string;
  nickname: string;
  savedPriceId: string | null;
  metadata: Record<string, string>;
}) {
  const stripe = getStripe();
  if (!stripe) throw new Error("STRIPE_SECRET_KEY is not configured.");

  if (input.savedPriceId) {
    try {
      const saved = await stripe.prices.retrieve(input.savedPriceId);
      if (
        isCurrentFourWeekPrice(
          saved,
          input.productId,
          input.amountCents,
        )
      ) {
        const updated = await stripe.prices.update(saved.id, {
          active: true,
          nickname: input.nickname,
          metadata: input.metadata,
        });
        return { price: updated, created: false };
      }
    } catch {
      // Continue to the lookup-key check.
    }
  }

  const byLookupKey = await stripe.prices.list({
    lookup_keys: [input.lookupKey],
    limit: 1,
  });
  const reusable = byLookupKey.data[0];
  if (
    reusable &&
    isCurrentFourWeekPrice(
      reusable,
      input.productId,
      input.amountCents,
    )
  ) {
    const updated = await stripe.prices.update(reusable.id, {
      active: true,
      nickname: input.nickname,
      metadata: input.metadata,
    });
    return { price: updated, created: false };
  }

  const created = await stripe.prices.create({
    product: input.productId,
    currency: "usd",
    unit_amount: input.amountCents,
    recurring: {
      interval: "week",
      interval_count: 4,
    },
    tax_behavior: "exclusive",
    nickname: input.nickname,
    lookup_key: input.lookupKey,
    transfer_lookup_key: Boolean(reusable),
    metadata: input.metadata,
  });

  if (reusable?.id && reusable.id !== created.id) {
    await stripe.prices.update(reusable.id, { active: false });
  }
  if (input.savedPriceId && input.savedPriceId !== created.id) {
    try {
      await stripe.prices.update(input.savedPriceId, { active: false });
    } catch {
      // The saved price may already be archived or deleted.
    }
  }

  return { price: created, created: true };
}

export async function syncBreadClubStripeCatalog() {
  const stripe = getStripe();
  const supabase = getSupabaseAdminClient();
  if (!stripe) throw new Error("STRIPE_SECRET_KEY is not configured.");
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const [plansResult, deliveryResult, settingsResult] = await Promise.all([
    supabase
      .from("bread_club_plans")
      .select(
        "id, slug, name, description, price_cents, active, stripe_product_id, stripe_price_id, stripe_price_cents, stripe_lookup_key",
      )
      .order("sort_order", { ascending: true }),
    supabase
      .from("bread_club_delivery_prices")
      .select(
        "id, band_key, label, price_cents, active, stripe_product_id, stripe_price_id, stripe_price_cents, stripe_lookup_key",
      )
      .order("min_minutes", { ascending: true }),
    supabase
      .from("bread_club_settings")
      .select("stripe_delivery_product_id")
      .eq("id", true)
      .maybeSingle(),
  ]);
  if (plansResult.error) throw new Error(plansResult.error.message);
  if (deliveryResult.error) throw new Error(deliveryResult.error.message);
  if (settingsResult.error) throw new Error(settingsResult.error.message);

  const planResults = [];
  for (const plan of (plansResult.data || []) as PlanRow[]) {
    const product = await ensureProduct({
      savedId: plan.stripe_product_id,
      name: `Sunday Bread Club - ${plan.name}`,
      description: plan.description,
      taxCode: STRIPE_TAX_CODES.foodForNonImmediateConsumption,
      metadata: {
        bread_club_plan_id: plan.id,
        bread_club_plan_slug: plan.slug,
        billing_period: "4_weeks",
      },
    });
    const { price, created } = await ensureRecurringPrice({
      productId: product.id,
      amountCents: plan.price_cents,
      lookupKey: plan.stripe_lookup_key,
      nickname: `${plan.name} every four weeks`,
      savedPriceId: plan.stripe_price_id,
      metadata: {
        bread_club_plan_id: plan.id,
        bread_club_plan_slug: plan.slug,
      },
    });
    await stripe.products.update(product.id, {
      active: plan.active,
      default_price: price.id,
    });

    const { error } = await supabase
      .from("bread_club_plans")
      .update({
        stripe_product_id: product.id,
        stripe_price_id: price.id,
        stripe_price_cents: plan.price_cents,
        stripe_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", plan.id);
    if (error) throw new Error(error.message);

    planResults.push({
      id: plan.id,
      name: plan.name,
      productId: product.id,
      priceId: price.id,
      createdPrice: created,
    });
  }

  const deliveryProduct = await ensureProduct({
    savedId:
      (settingsResult.data?.stripe_delivery_product_id as string | null) ||
      ((deliveryResult.data?.[0] as DeliveryPriceRow | undefined)
        ?.stripe_product_id ??
        null),
    name: "Sunday Bread Club local delivery",
    description:
      "Four Sunday deliveries per Bread Club billing cycle, priced by verified drive-time band.",
    taxCode: STRIPE_TAX_CODES.shipping,
    metadata: {
      bread_club_delivery_product: "true",
      billing_period: "4_weeks",
    },
  });

  const deliveryResults = [];
  for (const delivery of (deliveryResult.data || []) as DeliveryPriceRow[]) {
    const { price, created } = await ensureRecurringPrice({
      productId: deliveryProduct.id,
      amountCents: delivery.price_cents,
      lookupKey: delivery.stripe_lookup_key,
      nickname: `${delivery.label} every four weeks`,
      savedPriceId: delivery.stripe_price_id,
      metadata: {
        bread_club_delivery_band: delivery.band_key,
      },
    });
    const { error } = await supabase
      .from("bread_club_delivery_prices")
      .update({
        stripe_product_id: deliveryProduct.id,
        stripe_price_id: price.id,
        stripe_price_cents: delivery.price_cents,
        stripe_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", delivery.id);
    if (error) throw new Error(error.message);

    deliveryResults.push({
      id: delivery.id,
      bandKey: delivery.band_key,
      productId: deliveryProduct.id,
      priceId: price.id,
      createdPrice: created,
    });
  }

  const { error: settingsUpdateError } = await supabase
    .from("bread_club_settings")
    .update({
      stripe_delivery_product_id: deliveryProduct.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
  if (settingsUpdateError) throw new Error(settingsUpdateError.message);

  return { plans: planResults, delivery: deliveryResults };
}

export async function configureBreadClubStripeInfrastructure() {
  const stripe = getStripe();
  const supabase = getSupabaseAdminClient();
  if (!stripe) throw new Error("STRIPE_SECRET_KEY is not configured.");
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const webhookUrl = `${getSiteUrl()}/api/stripe/webhook`;
  const webhookEndpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  let webhook = webhookEndpoints.data.find(
    (endpoint) => endpoint.url === webhookUrl,
  );
  let webhookSecret: string | null = null;

  if (webhook) {
    webhook = await stripe.webhookEndpoints.update(webhook.id, {
      disabled: false,
      enabled_events: BREAD_CLUB_WEBHOOK_EVENTS,
      description: "Luna & Lorelai's Sourdough production webhook",
    });
  } else {
    const created = await stripe.webhookEndpoints.create({
      url: webhookUrl,
      enabled_events: BREAD_CLUB_WEBHOOK_EVENTS,
      description: "Luna & Lorelai's Sourdough production webhook",
    });
    webhook = created;
    webhookSecret = created.secret || null;
  }

  const configurations = await stripe.billingPortal.configurations.list({
    limit: 100,
  });
  let portal = configurations.data.find(
    (configuration) =>
      configuration.metadata?.bread_club_portal === "true",
  );
  const portalParams: Stripe.BillingPortal.ConfigurationCreateParams = {
    business_profile: {
      headline: "Manage your Sunday Bread Club billing",
      privacy_policy_url: `${getSiteUrl()}/policies/privacy`,
      terms_of_service_url: `${getSiteUrl()}/policies/terms`,
    },
    default_return_url: `${getSiteUrl()}/bread-club/manage`,
    features: {
      customer_update: {
        enabled: true,
        allowed_updates: ["email", "phone"],
      },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
        cancellation_reason: {
          enabled: true,
          options: [
            "too_expensive",
            "missing_features",
            "switched_service",
            "unused",
            "other",
          ],
        },
      },
    },
    metadata: {
      bread_club_portal: "true",
    },
  };

  if (portal) {
    portal = await stripe.billingPortal.configurations.update(
      portal.id,
      portalParams,
    );
  } else {
    portal = await stripe.billingPortal.configurations.create(portalParams);
  }

  const { error } = await supabase
    .from("bread_club_settings")
    .update({
      stripe_portal_configuration_id: portal.id,
      stripe_webhook_endpoint_id: webhook.id,
      tax_status: getBreadClubTaxStatus(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
  if (error) throw new Error(error.message);

  return {
    webhookEndpointId: webhook.id,
    webhookUrl,
    webhookSecret,
    portalConfigurationId: portal.id,
  };
}
