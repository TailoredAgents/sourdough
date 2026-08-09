import { createHash, randomBytes } from "crypto";
import { format } from "date-fns";
import type Stripe from "stripe";
import { checkDeliveryAddressWithRoutes } from "@/lib/delivery";
import { getDeliverySettingsData } from "@/lib/storefront-data";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdminClient } from "@/lib/supabase";
import type { DeliveryAddress } from "@/lib/types";
import { getSiteUrl } from "@/lib/utils";
import { isBreadClubAutomaticTaxEnabled } from "./config";
import { getBreadClubCatalogData } from "./data";
import {
  sendBreadClubCancellation,
  sendBreadClubAddonReceipt,
  sendBreadClubPlanChange,
  sendBreadClubSkipCredit,
} from "./emails";
import { getBreadClubMemberData } from "./member-data";
import {
  findBreadClubDeliveryPrice,
  normalizeBreadClubSelection,
  validateBreadClubSelection,
} from "./pricing";
import {
  findPendingCycleForMembership,
  releaseBreadClubPendingCycle,
} from "./records";
import { reconcileBreadClubProviderState } from "./provider-sync";
import type { BreadClubSelection } from "./types";

async function assertRenewalNotReserved(membershipId: string) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { count, error } = await supabase
    .from("bread_club_cycles")
    .select("id", { count: "exact", head: true })
    .eq("membership_id", membershipId)
    .in("status", ["pending_payment", "past_due"]);
  if (error) throw new Error(error.message);
  if ((count || 0) > 0) {
    throw new Error(
      "The next renewal is already reserved. Contact the bakery to change this cycle.",
    );
  }
}

export async function changeBreadClubSelection(
  membershipId: string,
  fulfillmentId: string,
  selection: BreadClubSelection[],
) {
  const member = await getBreadClubMemberData(membershipId);
  if (!member) throw new Error("Bread Club membership was not found.");
  const fulfillment = member.fulfillments.find(
    (item) => item.id === fulfillmentId,
  );
  if (!fulfillment) throw new Error("That Sunday delivery was not found.");

  const normalized = normalizeBreadClubSelection(selection);
  const selectionError = validateBreadClubSelection(
    member.plan,
    normalized,
  );
  if (selectionError) throw new Error(selectionError);

  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { error } = await supabase.rpc("swap_bread_club_selection", {
    p_fulfillment_id: fulfillmentId,
    p_selection: normalized.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity,
    })),
  });
  if (error) throw new Error(error.message);
  return getBreadClubMemberData(membershipId);
}

export async function skipBreadClubDelivery(
  membershipId: string,
  fulfillmentId: string,
) {
  const member = await getBreadClubMemberData(membershipId);
  if (!member) throw new Error("Bread Club membership was not found.");
  const fulfillment = member.fulfillments.find(
    (item) => item.id === fulfillmentId,
  );
  if (!fulfillment) throw new Error("That Sunday delivery was not found.");
  if (!member.stripeCustomerId || !member.stripeSubscriptionId) {
    throw new Error("Subscription billing is not connected for this membership.");
  }

  const supabase = getSupabaseAdminClient();
  const stripe = getStripe();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  if (!stripe) throw new Error("Stripe is not configured.");

  const { data, error } = await supabase.rpc(
    "skip_bread_club_fulfillment",
    { p_fulfillment_id: fulfillmentId },
  );
  if (error) throw new Error(error.message);
  const credit = data as {
    credit_id: string;
    quantity: number;
    delivery_fee_credit_cents: number;
  };

  let invoiceItemId: string | null = null;
  try {
    const invoiceItem = await stripe.invoiceItems.create(
      {
        customer: member.stripeCustomerId,
        subscription: member.stripeSubscriptionId,
        amount: -Number(credit.delivery_fee_credit_cents),
        currency: "usd",
        description: `Bread Club delivery credit for ${fulfillment.deliveryLabel}`,
        discountable: false,
        metadata: {
          bread_club_membership_id: membershipId,
          bread_club_rollover_credit_id: String(credit.credit_id),
        },
      },
      { idempotencyKey: `bread-club-credit-${credit.credit_id}` },
    );
    invoiceItemId = invoiceItem.id;
    const { error: updateError } = await supabase
      .from("bread_club_rollover_credits")
      .update({
        stripe_invoice_item_id: invoiceItem.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", credit.credit_id);
    if (updateError) throw new Error(updateError.message);
  } catch (error) {
    console.error("[bread-club] skip invoice credit needs reconciliation", {
      membershipId,
      creditId: credit.credit_id,
      error,
    });
  }

  try {
    const expiresAt = new Date(
      Date.now() + 60 * 24 * 60 * 60 * 1000,
    );
    await sendBreadClubSkipCredit({
      to: member.customerEmail,
      customerName: member.customerName,
      membershipId,
      skippedDelivery: fulfillment.deliveryLabel,
      loafQuantity: Number(credit.quantity),
      deliveryCreditCents: Number(credit.delivery_fee_credit_cents),
      expiresLabel: format(expiresAt, "MMMM d, yyyy"),
      manageUrl: `${getSiteUrl()}/bread-club/manage`,
      eventKey: `skip-credit:${credit.credit_id}`,
    });
  } catch (error) {
    console.error("[bread-club] skip email failed", error);
  }

  return {
    member: await getBreadClubMemberData(membershipId),
    billingCreditPending: !invoiceItemId,
  };
}

export async function redeemBreadClubCredit(
  membershipId: string,
  creditId: string,
  fulfillmentId: string,
  productId: string,
) {
  const member = await getBreadClubMemberData(membershipId);
  if (!member) throw new Error("Bread Club membership was not found.");
  if (!member.credits.some((credit) => credit.id === creditId)) {
    throw new Error("That rollover credit was not found.");
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { error } = await supabase.rpc("redeem_bread_club_credit", {
    p_credit_id: creditId,
    p_fulfillment_id: fulfillmentId,
    p_product_id: productId,
  });
  if (error) throw new Error(error.message);
  return getBreadClubMemberData(membershipId);
}

export async function scheduleBreadClubPlanChange(
  membershipId: string,
  planId: string,
  selection: BreadClubSelection[],
) {
  const [member, catalog] = await Promise.all([
    getBreadClubMemberData(membershipId),
    getBreadClubCatalogData(),
  ]);
  if (!member) throw new Error("Bread Club membership was not found.");
  await assertRenewalNotReserved(membershipId);
  const plan = catalog.plans.find(
    (item) => item.id === planId && item.active,
  );
  if (
    !plan ||
    !plan.stripePriceId ||
    plan.stripePriceCents !== plan.priceCents
  ) {
    throw new Error("That Bread Club plan is not ready for enrollment.");
  }
  const normalized = normalizeBreadClubSelection(selection);
  const selectionError = validateBreadClubSelection(plan, normalized);
  if (selectionError) throw new Error(selectionError);

  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const providerSelection = normalized.map((item) => ({
    product_id: item.productId,
    quantity: item.quantity,
  }));
  const { data: revisionData, error: beginError } = await supabase.rpc(
    "begin_bread_club_plan_provider_change",
    {
      p_membership_id: membershipId,
      p_plan_id: plan.id,
      p_selection: providerSelection,
    },
  );
  if (beginError) throw new Error(beginError.message);
  const revision = Number(revisionData);
  if (!Number.isSafeInteger(revision) || revision <= 0) {
    throw new Error("The Bread Club plan change could not be recorded.");
  }
  try {
    const synchronized = await reconcileBreadClubProviderState(
      membershipId,
      revision,
    );
    if (!synchronized) {
      throw new Error(
        "This provider-sync revision was deferred or superseded.",
      );
    }
  } catch (cause) {
    throw new Error(
      "Your plan choice was saved, but Stripe is still syncing it. We will retry automatically.",
      { cause },
    );
  }

  try {
    await sendBreadClubPlanChange({
      to: member.customerEmail,
      customerName: member.customerName,
      membershipId,
      newPlanName: plan.name,
      effectiveLabel: "with the next four-week billing cycle",
    });
  } catch (error) {
    console.error("[bread-club] plan-change email failed", error);
  }
  return getBreadClubMemberData(membershipId);
}

export async function updateBreadClubAddress(
  membershipId: string,
  address: DeliveryAddress,
  deliveryInstructions: string,
) {
  const [member, settings, catalog] = await Promise.all([
    getBreadClubMemberData(membershipId),
    getDeliverySettingsData(),
    getBreadClubCatalogData(),
  ]);
  if (!member) throw new Error("Bread Club membership was not found.");
  await assertRenewalNotReserved(membershipId);
  const lockedDelivery = member.fulfillments.find(
    (fulfillment) =>
      fulfillment.status === "scheduled" &&
      new Date(fulfillment.cutoffAt).getTime() <= Date.now() &&
      new Date(fulfillment.deliveryStartsAt).getTime() > Date.now(),
  );
  if (lockedDelivery) {
    throw new Error(
      "This Sunday's route is already locked. Contact the bakery to change the address.",
    );
  }

  const deliveryCheck = await checkDeliveryAddressWithRoutes(
    address,
    settings,
  );
  if (!deliveryCheck.eligible || deliveryCheck.preliminary) {
    throw new Error(
      deliveryCheck.message ||
        "That address could not be confirmed for delivery.",
    );
  }
  const deliveryPrice = findBreadClubDeliveryPrice(
    catalog.deliveryPrices,
    deliveryCheck.durationMinutes,
    deliveryCheck.feeCents,
  );
  if (
    !deliveryPrice ||
    !deliveryPrice.stripePriceId ||
    deliveryPrice.stripePriceCents !== deliveryPrice.priceCents
  ) {
    throw new Error("The updated delivery price is not ready.");
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const addressWithContact = {
    ...address,
    email: member.customerEmail,
    phone: member.customerPhone,
  };
  const { data: revisionData, error: beginError } = await supabase.rpc(
    "begin_bread_club_address_provider_change",
    {
      p_membership_id: membershipId,
      p_delivery_address: addressWithContact,
      p_delivery_instructions: deliveryInstructions || null,
      p_delivery_check: deliveryCheck,
      p_route_fee_cents: deliveryCheck.feeCents,
      p_route_band_key: deliveryPrice.bandKey,
    },
  );
  if (beginError) throw new Error(beginError.message);
  const revision = Number(revisionData);
  if (!Number.isSafeInteger(revision) || revision <= 0) {
    throw new Error("The Bread Club address change could not be recorded.");
  }
  try {
    const synchronized = await reconcileBreadClubProviderState(
      membershipId,
      revision,
    );
    if (!synchronized) {
      throw new Error(
        "This provider-sync revision was deferred or superseded.",
      );
    }
  } catch (cause) {
    throw new Error(
      "Your delivery change was saved, but Stripe is still syncing it. We will retry automatically.",
      { cause },
    );
  }
  return getBreadClubMemberData(membershipId);
}

export async function cancelBreadClubMembership(
  membershipId: string,
  reason: string,
) {
  const member = await getBreadClubMemberData(membershipId);
  if (!member) throw new Error("Bread Club membership was not found.");
  if (!member.stripeSubscriptionId) {
    throw new Error("The Stripe subscription is not connected.");
  }
  const stripe = getStripe();
  const supabase = getSupabaseAdminClient();
  if (!stripe) throw new Error("Stripe is not configured.");
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  await stripe.subscriptions.update(member.stripeSubscriptionId, {
    cancel_at_period_end: true,
    metadata: {
      bread_club_membership_id: membershipId,
      cancellation_requested_in_app: "true",
    },
  });

  const pendingCycle = await findPendingCycleForMembership(membershipId);
  if (pendingCycle) {
    await releaseBreadClubPendingCycle(pendingCycle.id);
  }

  const { error } = await supabase
    .from("bread_club_memberships")
    .update({
      status: "canceling",
      cancel_at_period_end: true,
      canceled_at: new Date().toISOString(),
      cancellation_reason: reason || "Canceled online by member",
      updated_at: new Date().toISOString(),
    })
    .eq("id", membershipId);
  if (error) throw new Error(error.message);

  const lastDelivery =
    [...member.fulfillments]
      .filter((item) => item.status === "scheduled")
      .sort(
        (left, right) =>
          new Date(right.deliveryStartsAt).getTime() -
          new Date(left.deliveryStartsAt).getTime(),
      )[0]?.deliveryLabel || "your final paid Sunday";
  try {
    await sendBreadClubCancellation({
      to: member.customerEmail,
      customerName: member.customerName,
      membershipId,
      finalDeliveryLabel: lastDelivery,
      eventKey: `membership-cancellation:${membershipId}`,
    });
  } catch (emailError) {
    console.error("[bread-club] cancellation email failed", emailError);
  }
  return getBreadClubMemberData(membershipId);
}

type AddonItem = {
  productId: string;
  quantity: number;
};

type BreadClubAddonCheckoutItem = {
  product_id: string;
  quantity: number;
  unit_price_cents: number;
  stripe_price_id: string;
  name: string;
};

type PendingBreadClubAddonCheckout = {
  addonId: string;
  membershipId: string;
  fulfillmentId: string;
  items: BreadClubAddonCheckoutItem[];
  subtotalCents: number;
  checkoutCancelToken: string;
  checkoutExpiresAt: string;
  automaticTaxEnabled: boolean;
  stripeCheckoutSessionId: string | null;
  status: string;
};

export class BreadClubAddonCheckoutError extends Error {
  constructor(
    message: string,
    readonly resetCheckoutAttempt: boolean,
  ) {
    super(message);
  }
}

function normalizeAddonItems(items: AddonItem[]) {
  const normalized = new Map<string, number>();
  for (const item of items) {
    if (item.productId && Number.isInteger(item.quantity) && item.quantity > 0) {
      normalized.set(
        item.productId,
        (normalized.get(item.productId) || 0) + item.quantity,
      );
    }
  }
  return Array.from(normalized, ([productId, quantity]) => ({
    productId,
    quantity,
  })).sort((left, right) => left.productId.localeCompare(right.productId));
}

function buildAddonCheckoutRequestHash(input: {
  checkoutAttemptId: string;
  fulfillmentId: string;
  items: AddonItem[];
  membershipId: string;
}) {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}

async function getExistingBreadClubAddonCheckout(
  membershipId: string,
  checkoutAttemptId: string,
  checkoutRequestHash: string,
): Promise<PendingBreadClubAddonCheckout | null> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { data, error } = await supabase
    .from("bread_club_addon_checkouts")
    .select(
      "id, membership_id, fulfillment_id, items, subtotal_cents, status, checkout_cancel_token, checkout_expires_at, checkout_automatic_tax_enabled, checkout_request_hash, stripe_checkout_session_id",
    )
    .eq("membership_id", membershipId)
    .eq("checkout_attempt_id", checkoutAttemptId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  if (data.checkout_request_hash !== checkoutRequestHash) {
    throw new Error(
      "Checkout attempt was already used with different add-on details.",
    );
  }
  if (
    !data.checkout_cancel_token ||
    !data.checkout_expires_at ||
    !Array.isArray(data.items)
  ) {
    throw new Error("Add-on checkout attempt is incomplete.");
  }
  return {
    addonId: String(data.id),
    membershipId: String(data.membership_id),
    fulfillmentId: String(data.fulfillment_id),
    items: data.items as BreadClubAddonCheckoutItem[],
    subtotalCents: Number(data.subtotal_cents),
    checkoutCancelToken: String(data.checkout_cancel_token),
    checkoutExpiresAt: String(data.checkout_expires_at),
    automaticTaxEnabled: Boolean(data.checkout_automatic_tax_enabled),
    stripeCheckoutSessionId: data.stripe_checkout_session_id
      ? String(data.stripe_checkout_session_id)
      : null,
    status: String(data.status),
  };
}

async function attachBreadClubAddonCheckout(
  addonId: string,
  sessionId: string,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { data, error } = await supabase.rpc(
    "attach_bread_club_addon_checkout",
    {
      p_addon_checkout_id: addonId,
      p_session_id: sessionId,
    },
  );
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Add-on checkout could not be attached.");
}

async function cancelBreadClubAddonCheckout(input: {
  addonId: string;
  checkoutCancelToken?: string | null;
  reason: "browser_cancel" | "expired";
  sessionId: string | null;
}) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { data, error } = await supabase.rpc(
    "cancel_bread_club_addon_checkout",
    {
      p_addon_checkout_id: input.addonId,
      p_session_id: input.sessionId,
      p_reason: input.reason,
      p_checkout_cancel_token: input.checkoutCancelToken || null,
    },
  );
  if (error) throw new Error(error.message);
  return Boolean(data);
}

async function confirmAddonSessionExpired(
  stripe: Stripe,
  sessionId: string,
) {
  try {
    const expired = await stripe.checkout.sessions.expire(sessionId);
    return expired.status === "expired";
  } catch {
    const current = await stripe.checkout.sessions.retrieve(sessionId);
    return current.status === "expired";
  }
}

async function startBreadClubAddonHostedCheckout(input: {
  checkoutAttemptId: string;
  checkout: PendingBreadClubAddonCheckout;
  customerEmail: string;
  stripeCustomerId: string | null;
}) {
  const stripe = getStripe();
  if (!stripe) throw new Error("Stripe is not configured.");
  const checkoutExpiresAt = Math.floor(
    new Date(input.checkout.checkoutExpiresAt).getTime() / 1000,
  );
  if (!Number.isSafeInteger(checkoutExpiresAt)) {
    throw new BreadClubAddonCheckoutError(
      "Add-on checkout expiration is invalid.",
      false,
    );
  }
  const currentTime = Math.floor(Date.now() / 1000);
  if (checkoutExpiresAt <= currentTime) {
    const released = await cancelBreadClubAddonCheckout({
      addonId: input.checkout.addonId,
      reason: "expired",
      sessionId: null,
    });
    throw new BreadClubAddonCheckoutError(
      "That add-on checkout expired. Please start checkout again.",
      released,
    );
  }
  if (checkoutExpiresAt < currentTime + 30 * 60) {
    throw new BreadClubAddonCheckoutError(
      "That add-on checkout is still being reconciled. Please try again after its payment link expires.",
      false,
    );
  }

  let session: Stripe.Checkout.Session | undefined;
  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        expires_at: checkoutExpiresAt,
        customer: input.stripeCustomerId || undefined,
        customer_email: input.stripeCustomerId
          ? undefined
          : input.customerEmail,
        line_items: input.checkout.items.map((item) => ({
          price: item.stripe_price_id,
          quantity: item.quantity,
        })),
        automatic_tax: { enabled: input.checkout.automaticTaxEnabled },
        success_url: `${getSiteUrl()}/bread-club/manage?addon=success`,
        cancel_url: `${getSiteUrl()}/api/bread-club/cancel-addon-checkout?addon_id=${input.checkout.addonId}&token=${input.checkout.checkoutCancelToken}`,
        metadata: {
          checkout_kind: "bread_club_addon",
          bread_club_addon_id: input.checkout.addonId,
          bread_club_membership_id: input.checkout.membershipId,
          bread_club_fulfillment_id: input.checkout.fulfillmentId,
          bread_club_checkout_attempt_id: input.checkoutAttemptId,
        },
      },
      {
        idempotencyKey: `bread-club-addon-${input.checkoutAttemptId}`,
      },
    );
    await attachBreadClubAddonCheckout(input.checkout.addonId, session.id);
    if (session.status === "complete") {
      try {
        await completeBreadClubAddonCheckout(session);
      } catch (completionError) {
        console.error("[bread-club] paid add-on completion deferred", {
          addonId: input.checkout.addonId,
          sessionId: session.id,
          completionError,
        });
      }
      return `${getSiteUrl()}/bread-club/manage?addon=success`;
    }
    if (session.status === "expired" || !session.url) {
      throw new Error("Stripe Checkout did not return an open payment link.");
    }
    return session.url;
  } catch (error) {
    let resetCheckoutAttempt = false;
    if (session?.id) {
      try {
        if (await confirmAddonSessionExpired(stripe, session.id)) {
          await attachBreadClubAddonCheckout(
            input.checkout.addonId,
            session.id,
          );
          resetCheckoutAttempt = await cancelBreadClubAddonCheckout({
            addonId: input.checkout.addonId,
            reason: "expired",
            sessionId: session.id,
          });
        }
      } catch (cleanupError) {
        console.error("[bread-club] add-on checkout cleanup deferred", {
          addonId: input.checkout.addonId,
          sessionId: session.id,
          cleanupError,
        });
      }
    } else {
      console.error(
        "[bread-club] add-on Stripe checkout outcome is uncertain",
        {
          addonId: input.checkout.addonId,
          checkoutAttemptId: input.checkoutAttemptId,
          error,
        },
      );
    }
    throw new BreadClubAddonCheckoutError(
      error instanceof Error
        ? error.message
        : "Add-on checkout could not be started.",
      resetCheckoutAttempt,
    );
  }
}

export async function createBreadClubAddonCheckout(
  membershipId: string,
  fulfillmentId: string,
  items: AddonItem[],
  checkoutAttemptId: string,
) {
  const normalizedItems = normalizeAddonItems(items);
  if (!normalizedItems.length) throw new Error("Choose at least one add-on.");
  const checkoutRequestHash = buildAddonCheckoutRequestHash({
    checkoutAttemptId,
    fulfillmentId,
    items: normalizedItems,
    membershipId,
  });
  const existing = await getExistingBreadClubAddonCheckout(
    membershipId,
    checkoutAttemptId,
    checkoutRequestHash,
  );
  const member = await getBreadClubMemberData(membershipId);
  if (!member) throw new Error("Bread Club membership was not found.");

  if (existing) {
    if (existing.status === "paid") {
      return { url: `${getSiteUrl()}/bread-club/manage?addon=success` };
    }
    if (existing.status !== "pending_payment") {
      throw new BreadClubAddonCheckoutError(
        "That add-on checkout is closed. Please start checkout again.",
        true,
      );
    }
    if (existing.stripeCheckoutSessionId) {
      const stripe = getStripe();
      if (!stripe) throw new Error("Stripe is not configured.");
      const session = await stripe.checkout.sessions.retrieve(
        existing.stripeCheckoutSessionId,
      );
      if (session.status === "open" && session.url) {
        return { url: session.url };
      }
      if (session.status === "complete") {
        try {
          await completeBreadClubAddonCheckout(session);
        } catch (completionError) {
          console.error("[bread-club] paid add-on completion deferred", {
            addonId: existing.addonId,
            sessionId: session.id,
            completionError,
          });
        }
        return { url: `${getSiteUrl()}/bread-club/manage?addon=success` };
      }
      if (session.status === "expired") {
        await expireBreadClubAddonCheckout(session.id, existing.addonId);
        throw new BreadClubAddonCheckoutError(
          "That add-on checkout expired. Please start checkout again.",
          true,
        );
      }
      throw new Error("Existing add-on checkout could not be resumed.");
    }
    return {
      url: await startBreadClubAddonHostedCheckout({
        checkoutAttemptId,
        checkout: existing,
        customerEmail: member.customerEmail,
        stripeCustomerId: member.stripeCustomerId,
      }),
    };
  }

  const fulfillment = member.fulfillments.find(
    (item) => item.id === fulfillmentId && item.status === "scheduled",
  );
  if (!fulfillment) throw new Error("Choose an upcoming Sunday delivery.");

  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const productIds = normalizedItems.map((item) => item.productId);

  const { data: menuItems, error: itemError } = await supabase
    .from("weekly_menu_items")
    .select(
      "product_id, available_quantity, sold_quantity, unavailable, products(id, name, description, category, price_cents, stripe_price_id, stripe_price_cents, active)",
    )
    .eq("weekly_menu_id", fulfillment.weeklyMenuId)
    .in("product_id", productIds);
  if (itemError) throw new Error(itemError.message);

  const checkoutItems = productIds.map((productId) => {
    const menuItem = menuItems?.find(
      (item) => String(item.product_id) === productId,
    );
    const product = Array.isArray(menuItem?.products)
      ? menuItem?.products[0]
      : menuItem?.products;
    const quantity =
      normalizedItems.find((item) => item.productId === productId)?.quantity ||
      0;
    if (
      !menuItem ||
      !product ||
      product.category !== "add-on" ||
      !product.active ||
      menuItem.unavailable ||
      Number(menuItem.available_quantity) - Number(menuItem.sold_quantity) <
        quantity
    ) {
      throw new Error("One selected add-on is no longer available.");
    }
    if (
      !product.stripe_price_id ||
      Number(product.stripe_price_cents) !== Number(product.price_cents)
    ) {
      throw new Error(`${product.name} is not ready for Stripe checkout.`);
    }
    return {
      product_id: productId,
      quantity,
      unit_price_cents: Number(product.price_cents),
      stripe_price_id: String(product.stripe_price_id),
      name: String(product.name),
    };
  });
  const subtotalCents = checkoutItems.reduce(
    (sum, item) => sum + item.quantity * item.unit_price_cents,
    0,
  );
  const automaticTaxEnabled = isBreadClubAutomaticTaxEnabled();

  const { data, error } = await supabase.rpc(
    "create_bread_club_addon_checkout",
    {
      p_checkout_attempt_id: checkoutAttemptId,
      p_checkout_request_hash: checkoutRequestHash,
      p_membership_id: membershipId,
      p_fulfillment_id: fulfillmentId,
      p_items: checkoutItems,
      p_subtotal_cents: subtotalCents,
      p_automatic_tax_enabled: automaticTaxEnabled,
      p_checkout_cancel_token: randomBytes(24).toString("hex"),
    },
  );
  if (error) throw new Error(error.message);
  const result = Array.isArray(data) ? data[0] : data;
  if (
    !result?.addon_checkout_id ||
    !result.membership_id ||
    !result.fulfillment_id ||
    !Array.isArray(result.items) ||
    typeof result.subtotal_cents !== "number" ||
    typeof result.checkout_cancel_token !== "string" ||
    typeof result.checkout_expires_at !== "string" ||
    typeof result.checkout_automatic_tax_enabled !== "boolean"
  ) {
    throw new Error("Add-on checkout command returned an invalid result.");
  }
  const pending: PendingBreadClubAddonCheckout = {
    addonId: String(result.addon_checkout_id),
    membershipId: String(result.membership_id),
    fulfillmentId: String(result.fulfillment_id),
    items: result.items as BreadClubAddonCheckoutItem[],
    subtotalCents: result.subtotal_cents,
    checkoutCancelToken: result.checkout_cancel_token,
    checkoutExpiresAt: result.checkout_expires_at,
    automaticTaxEnabled: result.checkout_automatic_tax_enabled,
    stripeCheckoutSessionId: result.stripe_checkout_session_id
      ? String(result.stripe_checkout_session_id)
      : null,
    status: "pending_payment",
  };
  return {
    url: await startBreadClubAddonHostedCheckout({
      checkoutAttemptId,
      checkout: pending,
      customerEmail: member.customerEmail,
      stripeCustomerId: member.stripeCustomerId,
    }),
  };
}

export async function completeBreadClubAddonCheckout(
  session: Stripe.Checkout.Session,
) {
  if (
    session.payment_status !== "paid" &&
    session.payment_status !== "no_payment_required"
  ) {
    return;
  }

  const addonId = session.metadata?.bread_club_addon_id;
  if (!addonId) return;
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  await attachBreadClubAddonCheckout(addonId, session.id);
  const { data: completed, error } = await supabase.rpc(
    "complete_bread_club_addon_checkout_fenced",
    {
      p_addon_checkout_id: addonId,
      p_session_id: session.id,
      p_payment_intent_id:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id || null,
      p_tax_cents: session.total_details?.amount_tax || 0,
      p_total_cents: session.amount_total,
    },
  );
  if (error) throw new Error(error.message);
  if (!completed) throw new Error("Paid add-on checkout was not completed.");

  const { data: addon, error: lookupError } = await supabase
    .from("bread_club_addon_checkouts")
    .select(
      "membership_id, subtotal_cents, tax_cents, total_cents, items, bread_club_memberships(customers(name, email)), bread_club_fulfillments(delivery_windows(label))",
    )
    .eq("id", addonId)
    .maybeSingle();
  if (lookupError || !addon) return;
  const membership = Array.isArray(addon.bread_club_memberships)
    ? addon.bread_club_memberships[0]
    : addon.bread_club_memberships;
  const customer = Array.isArray(membership?.customers)
    ? membership?.customers[0]
    : membership?.customers;
  const fulfillment = Array.isArray(addon.bread_club_fulfillments)
    ? addon.bread_club_fulfillments[0]
    : addon.bread_club_fulfillments;
  const window = Array.isArray(fulfillment?.delivery_windows)
    ? fulfillment?.delivery_windows[0]
    : fulfillment?.delivery_windows;
  if (!customer?.email) return;
  const itemRows = Array.isArray(addon.items)
    ? (addon.items as Array<{
        name?: string;
        quantity?: number;
      }>)
    : [];
  try {
    await sendBreadClubAddonReceipt({
      to: String(customer.email),
      customerName: String(customer.name || "there"),
      membershipId: String(addon.membership_id),
      deliveryLabel: String(window?.label || "your Sunday delivery"),
      orderSummary: itemRows
        .map((item) => `${Number(item.quantity || 0)} x ${item.name || "Add-on"}`)
        .join("\n"),
      totalCents: Number(addon.total_cents),
      eventKey: `addon-checkout:${session.id}:receipt`,
    });
  } catch (emailError) {
    console.error("[bread-club] add-on receipt failed", emailError);
  }
}

export async function expireBreadClubAddonCheckout(
  sessionId: string,
  recoveryAddonId?: string | null,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  if (recoveryAddonId) {
    await attachBreadClubAddonCheckout(recoveryAddonId, sessionId);
  }
  const { data, error } = await supabase
    .from("bread_club_addon_checkouts")
    .select("id")
    .eq("stripe_checkout_session_id", sessionId)
    .eq("status", "pending_payment")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return;
  return cancelBreadClubAddonCheckout({
    addonId: String(data.id),
    reason: "expired",
    sessionId,
  });
}

export async function expireUnattachedBreadClubAddonCheckout(
  addonId: string,
) {
  return cancelBreadClubAddonCheckout({
    addonId,
    reason: "expired",
    sessionId: null,
  });
}

export async function getBreadClubAddonCheckoutForCancellation(
  addonId: string,
  token: string,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { data, error } = await supabase
    .from("bread_club_addon_checkouts")
    .select("id, membership_id, stripe_checkout_session_id")
    .eq("id", addonId)
    .eq("checkout_cancel_token", token)
    .eq("status", "pending_payment")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    addonId: String(data.id),
    membershipId: String(data.membership_id),
    sessionId: data.stripe_checkout_session_id
      ? String(data.stripe_checkout_session_id)
      : null,
  };
}

export async function cancelBreadClubAddonCheckoutByToken(
  addonId: string,
  token: string,
  sessionId: string | null,
) {
  return cancelBreadClubAddonCheckout({
    addonId,
    checkoutCancelToken: token,
    reason: "browser_cancel",
    sessionId,
  });
}
