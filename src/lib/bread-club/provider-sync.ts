import { getStripe } from "@/lib/stripe";
import { updateStripeDeliveryCustomer } from "@/lib/stripe-tax";
import { getSupabaseAdminClient } from "@/lib/supabase";
import type { DeliveryAddress } from "@/lib/types";

type ProviderSyncMembership = {
  id: string;
  stripe_customer_id: string | null;
  stripe_plan_subscription_item_id: string | null;
  stripe_delivery_subscription_item_id: string | null;
  provider_sync_revision: number | string;
  provider_sync_required: boolean;
  provider_sync_claim_token: string | null;
  provider_desired_plan_price_id: string | null;
  provider_desired_plan_price_cents: number | string | null;
  provider_desired_delivery_price_id: string | null;
  provider_desired_delivery_price_cents: number | string | null;
  provider_desired_delivery_address: DeliveryAddress | null;
  provider_desired_customer_name: string | null;
  provider_desired_customer_phone: string | null;
};

type ProviderSyncClaim = {
  sync_revision: number | string;
  sync_claim_token: string;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 2000) : "Provider sync failed.";
}

function firstRpcRow<T>(data: unknown) {
  if (Array.isArray(data)) return (data[0] as T | undefined) || null;
  return data && typeof data === "object" ? (data as T) : null;
}

function validStripePriceId(value: string | null) {
  return Boolean(
    value && value.length <= 255 && /^price_[A-Za-z0-9_]+$/.test(value),
  );
}

function validPriceCents(value: number | string | null) {
  const cents = Number(value);
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= 1_000_000;
}

function returnedPriceId(item: { price?: { id?: string } | string | null }) {
  return typeof item.price === "string" ? item.price : item.price?.id;
}

async function claimProviderSync(
  membershipId: string,
  expectedRevision?: number,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { data, error } = await supabase.rpc(
    "claim_bread_club_provider_sync",
    {
      p_membership_id: membershipId,
      p_expected_revision: expectedRevision ?? null,
    },
  );
  if (error) throw new Error(error.message);
  const claim = firstRpcRow<ProviderSyncClaim>(data);
  if (!claim) return null;
  const revision = Number(claim.sync_revision);
  if (
    !Number.isSafeInteger(revision) ||
    revision <= 0 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      String(claim.sync_claim_token || ""),
    )
  ) {
    throw new Error("Bread Club provider-sync claim is invalid.");
  }
  return { revision, token: String(claim.sync_claim_token) };
}

async function finishProviderSync(
  membershipId: string,
  revision: number,
  claimToken: string,
  error: string | null,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { data, error: rpcError } = await supabase.rpc(
    "finish_bread_club_provider_sync",
    {
      p_membership_id: membershipId,
      p_revision: revision,
      p_claim_token: claimToken,
      p_error: error,
    },
  );
  if (rpcError) throw new Error(rpcError.message);
  return data === true;
}

export async function reconcileBreadClubProviderState(
  membershipId: string,
  expectedRevision?: number,
) {
  const supabase = getSupabaseAdminClient();
  const stripe = getStripe();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  if (!stripe) throw new Error("Stripe is not configured.");

  const claim = await claimProviderSync(membershipId, expectedRevision);
  if (!claim) return false;
  const { revision, token: claimToken } = claim;

  try {
    const { data, error } = await supabase
      .from("bread_club_memberships")
      .select(
        "id, stripe_customer_id, stripe_plan_subscription_item_id, stripe_delivery_subscription_item_id, provider_sync_revision, provider_sync_required, provider_sync_claim_token, provider_desired_plan_price_id, provider_desired_plan_price_cents, provider_desired_delivery_price_id, provider_desired_delivery_price_cents, provider_desired_delivery_address, provider_desired_customer_name, provider_desired_customer_phone",
      )
      .eq("id", membershipId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Bread Club membership was not found.");

    const membership = data as ProviderSyncMembership;
    if (
      Number(membership.provider_sync_revision) !== revision ||
      membership.provider_sync_required !== true ||
      membership.provider_sync_claim_token !== claimToken
    ) {
      throw new Error("Bread Club provider-sync claim was superseded.");
    }
    if (
      !validStripePriceId(membership.provider_desired_plan_price_id) ||
      !validPriceCents(membership.provider_desired_plan_price_cents)
    ) {
      throw new Error("The desired Bread Club plan price is invalid.");
    }
    if (
      !validStripePriceId(membership.provider_desired_delivery_price_id) ||
      !validPriceCents(membership.provider_desired_delivery_price_cents)
    ) {
      throw new Error("The desired Bread Club delivery price is invalid.");
    }
    if (!membership.provider_desired_delivery_address) {
      throw new Error("The desired Bread Club delivery address is invalid.");
    }
    if (!membership.provider_desired_customer_name) {
      throw new Error("The desired Bread Club customer name is invalid.");
    }
    if (!membership.stripe_customer_id) {
      throw new Error("The Stripe customer is not connected.");
    }
    if (!membership.stripe_plan_subscription_item_id) {
      throw new Error("The subscription plan item is not connected.");
    }
    if (!membership.stripe_delivery_subscription_item_id) {
      throw new Error("The subscription delivery item is not connected.");
    }

    const desiredPlanPriceId = String(
      membership.provider_desired_plan_price_id,
    );
    const desiredDeliveryPriceId = String(
      membership.provider_desired_delivery_price_id,
    );
    const planItem = await stripe.subscriptionItems.update(
      membership.stripe_plan_subscription_item_id,
      {
        price: desiredPlanPriceId,
        proration_behavior: "none",
      },
      {
        idempotencyKey: `bread-club-provider-plan-${membershipId}-${revision}`,
      },
    );
    if (returnedPriceId(planItem) !== desiredPlanPriceId) {
      throw new Error("Stripe returned an unexpected Bread Club plan price.");
    }
    const deliveryItem = await stripe.subscriptionItems.update(
      membership.stripe_delivery_subscription_item_id,
      {
        price: desiredDeliveryPriceId,
        proration_behavior: "none",
      },
      {
        idempotencyKey: `bread-club-provider-delivery-${membershipId}-${revision}`,
      },
    );
    if (returnedPriceId(deliveryItem) !== desiredDeliveryPriceId) {
      throw new Error(
        "Stripe returned an unexpected Bread Club delivery price.",
      );
    }

    await updateStripeDeliveryCustomer(
      stripe,
      membership.stripe_customer_id,
      {
        name: membership.provider_desired_customer_name,
        phone: String(membership.provider_desired_customer_phone || ""),
        address: membership.provider_desired_delivery_address,
      },
      {
        idempotencyKey: `bread-club-provider-address-${membershipId}-${revision}`,
      },
    );

    return finishProviderSync(membershipId, revision, claimToken, null);
  } catch (providerError) {
    try {
      await finishProviderSync(
        membershipId,
        revision,
        claimToken,
        errorMessage(providerError),
      );
    } catch (recordError) {
      console.error("[bread-club] provider-sync failure could not be recorded", {
        membershipId,
        revision,
        recordError,
      });
    }
    throw providerError;
  }
}

export async function reconcilePendingBreadClubProviderChanges(limit = 50) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { data, error } = await supabase
    .from("bread_club_memberships")
    .select("id")
    .eq("provider_sync_required", true)
    .order("updated_at", { ascending: true })
    .limit(Math.max(1, Math.min(200, Math.floor(limit))));
  if (error) throw new Error(error.message);

  const report = {
    succeeded: 0,
    deferred: 0,
    errors: [] as string[],
  };
  for (const row of data || []) {
    try {
      const completed = await reconcileBreadClubProviderState(String(row.id));
      if (completed) report.succeeded += 1;
      else report.deferred += 1;
    } catch (syncError) {
      report.deferred += 1;
      report.errors.push(`${row.id}: ${errorMessage(syncError)}`);
    }
  }
  return report;
}
