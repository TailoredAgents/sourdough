import { randomBytes } from "crypto";
import type { DeliveryCheckResult } from "@/lib/delivery";
import { ensureRollingWeeklyMenus } from "@/lib/rolling-weeks";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { getBreadClubEnrollmentData } from "./data";
import {
  getBreadClubRenewalPricing,
  normalizeBreadClubSelection,
  validateBreadClubSelection,
} from "./pricing";
import {
  buildCycleFulfillmentInput,
  isBreadClubProductAvailableForAllWeeks,
} from "./schedule";
import type {
  BreadClubCheckoutRequest,
  BreadClubDeliveryPrice,
  BreadClubEnrollmentWeek,
  BreadClubPlan,
  BreadClubSelection,
} from "./types";

type CreatePendingBreadClubInput = {
  checkout: BreadClubCheckoutRequest;
  deliveryCheck: DeliveryCheckResult;
  deliveryPrice: BreadClubDeliveryPrice;
  plan: BreadClubPlan;
  selection: BreadClubSelection[];
  weeks: BreadClubEnrollmentWeek[];
  consentIpHash: string | null;
  consentVersion: string;
  checkoutRequestHash: string;
  automaticTaxEnabled: boolean;
};

export type PendingBreadClubCheckout = {
  membershipId: string;
  cycleId: string;
  customerId: string;
  checkoutCancelToken: string;
  firstDeliveryAt: string;
  cycleTotalCents: number;
  checkoutExpiresAt: string;
  planStripePriceId: string;
  deliveryStripePriceId: string;
  routeBandKey: string;
  automaticTaxEnabled: boolean;
};

export type ExistingBreadClubCheckoutAttempt = {
  pending: PendingBreadClubCheckout;
  planId: string;
  routeBandKey: string;
  consentVersion: string;
  status: string;
  stripeCheckoutSessionId: string | null;
};

type PendingBreadClubCycleRecord = {
  id: string;
  cycleNumber: number;
  status: string;
  periodStart: string;
  periodEnd: string;
  planPriceCents: number;
  deliveryPriceCents: number;
  totalCents: number;
  fulfillments: Array<{ id: string; orderId: string | null }>;
};

function normalizedEmail(email: string) {
  return email.trim().toLowerCase();
}

function cycleEndFrom(date: Date) {
  return new Date(date.getTime() + 28 * 24 * 60 * 60 * 1000);
}

export function validateSelectionAcrossCycle(
  plan: BreadClubPlan,
  selection: BreadClubSelection[],
  weeks: BreadClubEnrollmentWeek[],
) {
  const selectionError = validateBreadClubSelection(plan, selection);
  if (selectionError) return selectionError;
  if (weeks.length !== 4) {
    return "Four normally available Sunday delivery dates are required.";
  }

  if (
    selection.some(
      (item) =>
        !isBreadClubProductAvailableForAllWeeks(
          item.productId,
          weeks,
          item.quantity,
        ),
    )
  ) {
    return "One selected loaf is not available for all four Sundays.";
  }

  return null;
}

export async function createPendingBreadClubCheckout({
  checkout,
  checkoutRequestHash,
  automaticTaxEnabled,
  consentIpHash,
  consentVersion,
  deliveryCheck,
  deliveryPrice,
  plan,
  selection,
  weeks,
}: CreatePendingBreadClubInput): Promise<PendingBreadClubCheckout> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const normalizedSelection = normalizeBreadClubSelection(selection);
  const selectionError = validateSelectionAcrossCycle(
    plan,
    normalizedSelection,
    weeks,
  );
  if (selectionError) throw new Error(selectionError);

  const checkoutCancelToken = randomBytes(24).toString("hex");
  const { data, error } = await supabase.rpc(
    "create_bread_club_subscription_checkout",
    {
      p_checkout_attempt_id: checkout.checkoutAttemptId,
      p_checkout_request_hash: checkoutRequestHash,
      p_automatic_tax_enabled: automaticTaxEnabled,
      p_customer_name: checkout.customer.name,
      p_customer_email: normalizedEmail(checkout.customer.email),
      p_customer_phone: checkout.customer.phone,
      p_plan_id: plan.id,
      p_delivery_price_id: deliveryPrice.id,
      p_expected_plan_price_cents: plan.priceCents,
      p_expected_delivery_price_cents: deliveryPrice.priceCents,
      p_default_selection: normalizedSelection.map((item) => ({
        product_id: item.productId,
        quantity: item.quantity,
      })),
      p_delivery_address: {
        ...checkout.address,
        email: normalizedEmail(checkout.customer.email),
        phone: checkout.customer.phone,
      },
      p_delivery_instructions: checkout.deliveryInstructions || null,
      p_delivery_check: deliveryCheck,
      p_consent_version: consentVersion,
      p_consent_text: checkout.consentText,
      p_consent_ip_hash: consentIpHash,
      p_checkout_cancel_token: checkoutCancelToken,
      p_fulfillments: buildCycleFulfillmentInput(
        weeks,
        normalizedSelection,
      ),
    },
  );
  if (error) throw new Error(error.message);

  const result = Array.isArray(data) ? data[0] : data;
  if (
    !result?.membership_id ||
    !result.cycle_id ||
    !result.customer_id ||
    typeof result.checkout_cancel_token !== "string" ||
    typeof result.first_delivery_at !== "string" ||
    typeof result.cycle_total_cents !== "number" ||
    typeof result.checkout_expires_at !== "string" ||
    typeof result.plan_stripe_price_id !== "string" ||
    typeof result.delivery_stripe_price_id !== "string" ||
    typeof result.route_band_key !== "string" ||
    typeof result.checkout_automatic_tax_enabled !== "boolean"
  ) {
    throw new Error("Bread Club checkout command returned an invalid result.");
  }

  return {
    membershipId: String(result.membership_id),
    cycleId: String(result.cycle_id),
    customerId: String(result.customer_id),
    checkoutCancelToken: result.checkout_cancel_token,
    firstDeliveryAt: result.first_delivery_at,
    cycleTotalCents: result.cycle_total_cents,
    checkoutExpiresAt: result.checkout_expires_at,
    planStripePriceId: result.plan_stripe_price_id,
    deliveryStripePriceId: result.delivery_stripe_price_id,
    routeBandKey: result.route_band_key,
    automaticTaxEnabled: result.checkout_automatic_tax_enabled,
  };
}

export async function getExistingBreadClubCheckoutAttempt(
  checkoutAttemptId: string,
  checkoutRequestHash: string,
): Promise<ExistingBreadClubCheckoutAttempt | null> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data: membership, error } = await supabase
    .from("bread_club_memberships")
    .select(
      "id, customer_id, plan_id, status, current_cycle_id, route_band_key, first_delivery_at, checkout_cancel_token, checkout_request_hash, checkout_expires_at, checkout_plan_stripe_price_id, checkout_delivery_stripe_price_id, checkout_automatic_tax_enabled, stripe_checkout_session_id, consent_version",
    )
    .eq("checkout_attempt_id", checkoutAttemptId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!membership) return null;
  if (membership.checkout_request_hash !== checkoutRequestHash) {
    throw new Error(
      "Checkout attempt was already used with different Bread Club details.",
    );
  }
  if (
    !membership.current_cycle_id ||
    !membership.checkout_cancel_token ||
    !membership.checkout_expires_at ||
    !membership.checkout_plan_stripe_price_id ||
    !membership.checkout_delivery_stripe_price_id
  ) {
    throw new Error("Bread Club checkout attempt is incomplete.");
  }

  const { data: cycle, error: cycleError } = await supabase
    .from("bread_club_cycles")
    .select("id, total_cents")
    .eq("id", membership.current_cycle_id)
    .eq("membership_id", membership.id)
    .maybeSingle();
  if (cycleError) throw new Error(cycleError.message);
  if (!cycle) throw new Error("Bread Club checkout cycle was not found.");

  return {
    pending: {
      membershipId: String(membership.id),
      cycleId: String(cycle.id),
      customerId: String(membership.customer_id),
      checkoutCancelToken: String(membership.checkout_cancel_token),
      firstDeliveryAt: String(membership.first_delivery_at),
      cycleTotalCents: Number(cycle.total_cents),
      checkoutExpiresAt: String(membership.checkout_expires_at),
      planStripePriceId: String(membership.checkout_plan_stripe_price_id),
      deliveryStripePriceId: String(
        membership.checkout_delivery_stripe_price_id,
      ),
      routeBandKey: String(membership.route_band_key),
      automaticTaxEnabled: Boolean(
        membership.checkout_automatic_tax_enabled,
      ),
    },
    planId: String(membership.plan_id),
    routeBandKey: String(membership.route_band_key),
    consentVersion: String(membership.consent_version),
    status: String(membership.status),
    stripeCheckoutSessionId: membership.stripe_checkout_session_id
      ? String(membership.stripe_checkout_session_id)
      : null,
  };
}

export async function attachStripeSubscriptionCheckout(
  membershipId: string,
  sessionId: string,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data, error } = await supabase.rpc(
    "attach_bread_club_subscription_checkout",
    {
      p_membership_id: membershipId,
      p_session_id: sessionId,
    },
  );
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Bread Club checkout could not be attached.");
}

export async function releaseBreadClubPendingCycle(cycleId: string) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { error } = await supabase.rpc("release_bread_club_cycle", {
    p_cycle_id: cycleId,
  });
  if (error) throw new Error(error.message);
}

export async function markBreadClubCheckoutIncomplete(
  membershipId: string,
  cycleId: string,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { data, error } = await supabase.rpc(
    "cancel_bread_club_subscription_checkout",
    {
      p_membership_id: membershipId,
      p_cycle_id: cycleId,
      p_session_id: null,
      p_checkout_cancel_token: null,
      p_reason: "No Stripe Checkout Session was attached before expiration.",
    },
  );
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function getBreadClubCheckoutForCancellation(
  membershipId: string,
  token: string,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data, error } = await supabase
    .from("bread_club_memberships")
    .select("id, current_cycle_id, stripe_checkout_session_id")
    .eq("id", membershipId)
    .eq("checkout_cancel_token", token)
    .eq("status", "pending_checkout")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.current_cycle_id) return null;
  return {
    membershipId: String(data.id),
    cycleId: String(data.current_cycle_id),
    sessionId: data.stripe_checkout_session_id
      ? String(data.stripe_checkout_session_id)
      : null,
  };
}

export async function cancelBreadClubCheckoutByToken(
  membershipId: string,
  token: string,
  sessionId: string | null,
  cycleId?: string | null,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data, error } = await supabase.rpc(
    "cancel_bread_club_subscription_checkout",
    {
      p_membership_id: membershipId,
      p_cycle_id: cycleId || null,
      p_session_id: sessionId,
      p_checkout_cancel_token: token,
      p_reason: "Stripe Checkout was canceled by the customer.",
    },
  );
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function expireBreadClubCheckoutSession(
  sessionId: string,
  recoveryMembershipId?: string | null,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  if (recoveryMembershipId) {
    await attachStripeSubscriptionCheckout(recoveryMembershipId, sessionId);
  }
  const { data: membership, error } = await supabase
    .from("bread_club_memberships")
    .select("id, current_cycle_id")
    .eq("stripe_checkout_session_id", sessionId)
    .eq("status", "pending_checkout")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!membership?.current_cycle_id) return null;

  const { data, error: cancelError } = await supabase.rpc(
    "cancel_bread_club_subscription_checkout",
    {
      p_membership_id: membership.id,
      p_cycle_id: membership.current_cycle_id,
      p_session_id: sessionId,
      p_checkout_cancel_token: null,
      p_reason: "Stripe Checkout Session expired before payment.",
    },
  );
  if (cancelError) throw new Error(cancelError.message);
  return data ? String(membership.id) : null;
}

export async function recordBreadClubCheckoutCompleted(input: {
  membershipId: string;
  sessionId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  planSubscriptionItemId?: string | null;
  deliverySubscriptionItemId?: string | null;
  currentPeriodEnd?: string | null;
}) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data, error } = await supabase.rpc(
    "record_bread_club_subscription_checkout_completed",
    {
      p_membership_id: input.membershipId,
      p_session_id: input.sessionId,
      p_stripe_customer_id: input.stripeCustomerId,
      p_stripe_subscription_id: input.stripeSubscriptionId,
      p_plan_subscription_item_id: input.planSubscriptionItemId || null,
      p_delivery_subscription_item_id:
        input.deliverySubscriptionItemId || null,
      p_current_period_end: input.currentPeriodEnd || null,
    },
  );
  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error("Bread Club checkout completion was not recorded.");
  }
}

export async function activateBreadClubCycleForInvoice(input: {
  membershipId: string;
  cycleId: string;
  invoiceId: string;
  paymentIntentId?: string | null;
  amountPaidCents?: number | null;
  taxCents?: number | null;
  paidAt?: string;
}) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const updates: Record<string, unknown> = {
    stripe_invoice_id: input.invoiceId,
    tax_cents: input.taxCents || 0,
    paid_at: input.paidAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (typeof input.amountPaidCents === "number") {
    updates.total_cents = input.amountPaidCents;
  }
  if (input.paymentIntentId) {
    updates.stripe_payment_intent_id = input.paymentIntentId;
  }

  const { error: cycleUpdateError } = await supabase
    .from("bread_club_cycles")
    .update(updates)
    .eq("id", input.cycleId)
    .eq("membership_id", input.membershipId);
  if (cycleUpdateError) throw new Error(cycleUpdateError.message);

  const { error: activationError } = await supabase.rpc(
    "activate_bread_club_cycle",
    {
      p_cycle_id: input.cycleId,
      p_stripe_invoice_id: input.invoiceId,
      p_stripe_payment_intent_id: input.paymentIntentId || null,
      p_paid_at: input.paidAt || new Date().toISOString(),
    },
  );
  if (activationError) throw new Error(activationError.message);

  const { error: membershipError } = await supabase
    .from("bread_club_memberships")
    .update({
      status: "active",
      last_payment_failure_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.membershipId)
    .in("status", ["pending_checkout", "past_due", "active"]);
  if (membershipError) throw new Error(membershipError.message);
}

async function getPendingCycleRecord(
  membershipId: string,
): Promise<PendingBreadClubCycleRecord | null> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data, error } = await supabase
    .from("bread_club_cycles")
    .select(
      "id, cycle_number, status, period_start, period_end, plan_price_cents, delivery_price_cents, total_cents",
    )
    .eq("membership_id", membershipId)
    .in("status", ["pending_payment", "past_due"])
    .order("cycle_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const { data: fulfillmentRows, error: fulfillmentError } = await supabase
    .from("bread_club_fulfillments")
    .select("id, order_id")
    .eq("cycle_id", data.id);
  if (fulfillmentError) throw new Error(fulfillmentError.message);

  return {
    id: String(data.id),
    cycleNumber: Number(data.cycle_number),
    status: String(data.status),
    periodStart: String(data.period_start),
    periodEnd: String(data.period_end),
    planPriceCents: Number(data.plan_price_cents),
    deliveryPriceCents: Number(data.delivery_price_cents),
    totalCents: Number(data.total_cents),
    fulfillments: (fulfillmentRows || []).map((fulfillment) => ({
      id: String(fulfillment.id),
      orderId: fulfillment.order_id ? String(fulfillment.order_id) : null,
    })),
  };
}

async function ensureAtomicBreadClubRenewalCycle(input: {
  membershipId: string;
  cycleNumber: number;
  periodStart: string;
  periodEnd: string;
  planPriceCents: number;
  deliveryPriceCents: number;
  totalCents: number;
  fulfillments: ReturnType<typeof buildCycleFulfillmentInput> | null;
}) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data, error } = await supabase.rpc(
    "ensure_atomic_bread_club_renewal_cycle",
    {
      p_membership_id: input.membershipId,
      p_cycle_number: input.cycleNumber,
      p_period_start: input.periodStart,
      p_period_end: input.periodEnd,
      p_plan_price_cents: input.planPriceCents,
      p_delivery_price_cents: input.deliveryPriceCents,
      p_total_cents: input.totalCents,
      p_fulfillments: input.fulfillments,
    },
  );
  if (error) throw new Error(error.message);

  const result = Array.isArray(data) ? data[0] : data;
  if (
    !result?.renewal_cycle_id ||
    !Number.isInteger(Number(result.renewal_cycle_number))
  ) {
    throw new Error("Bread Club renewal command returned an invalid result.");
  }
  return {
    id: String(result.renewal_cycle_id),
    cycleNumber: Number(result.renewal_cycle_number),
  };
}

export async function findPendingCycleForMembership(membershipId: string) {
  const pending = await getPendingCycleRecord(membershipId);
  if (!pending) return null;
  if (
    pending.fulfillments.length !== 4 ||
    pending.fulfillments.some((fulfillment) => !fulfillment.orderId)
  ) {
    throw new Error(
      "Pending Bread Club renewal does not have four complete fulfillment orders.",
    );
  }
  return { id: pending.id, cycleNumber: pending.cycleNumber };
}

export async function findBreadClubCycleByInvoiceId(invoiceId: string) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data, error } = await supabase
    .from("bread_club_cycles")
    .select("id, membership_id, cycle_number, status")
    .eq("stripe_invoice_id", invoiceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data
    ? {
        id: String(data.id),
        membershipId: String(data.membership_id),
        cycleNumber: Number(data.cycle_number),
        status: String(data.status),
      }
    : null;
}

export async function prepareNextBreadClubCycle(
  membershipId: string,
  now = new Date(),
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const pending = await getPendingCycleRecord(membershipId);
  if (pending && pending.fulfillments.length > 0) {
    return ensureAtomicBreadClubRenewalCycle({
      membershipId,
      cycleNumber: pending.cycleNumber,
      periodStart: pending.periodStart,
      periodEnd: pending.periodEnd,
      planPriceCents: pending.planPriceCents,
      deliveryPriceCents: pending.deliveryPriceCents,
      totalCents: pending.totalCents,
      fulfillments: null,
    });
  }

  await ensureRollingWeeklyMenus(now);
  const enrollment = await getBreadClubEnrollmentData(now);
  const { data: membership, error: membershipError } = await supabase
    .from("bread_club_memberships")
    .select(
      "id, plan_id, pending_plan_id, default_selection, route_fee_cents, route_band_key, pending_route_fee_cents, pending_route_band_key, pending_delivery_address, pending_delivery_check, stripe_current_period_end",
    )
    .eq("id", membershipId)
    .in("status", ["active", "past_due"])
    .maybeSingle();
  if (membershipError) throw new Error(membershipError.message);
  if (!membership) throw new Error("Active Bread Club membership was not found.");

  const { data: existingFulfillments, error: fulfillmentError } = await supabase
    .from("bread_club_fulfillments")
    .select("weekly_menu_id")
    .eq("membership_id", membershipId);
  if (fulfillmentError) throw new Error(fulfillmentError.message);
  const usedMenuIds = new Set(
    (existingFulfillments || []).map((item) => String(item.weekly_menu_id)),
  );
  const weeks = enrollment.weeks
    .filter((week) => !usedMenuIds.has(week.weeklyMenu.id))
    .slice(0, 4);
  if (weeks.length !== 4) {
    throw new Error("Four future Sunday menus are not ready for renewal.");
  }

  const planId = String(membership.pending_plan_id || membership.plan_id);
  const plan = enrollment.plans.find((item) => item.id === planId);
  if (!plan) throw new Error("The membership plan is not available.");

  const rawSelection = Array.isArray(membership.default_selection)
    ? membership.default_selection
    : [];
  const selection = rawSelection.map(
    (item: { product_id?: string; quantity?: number }) => ({
      productId: String(item.product_id || ""),
      quantity: Number(item.quantity || 0),
    }),
  );
  const selectionError = validateSelectionAcrossCycle(plan, selection, weeks);
  if (selectionError) throw new Error(selectionError);

  const routeBandKey = String(
    membership.pending_route_band_key || membership.route_band_key,
  );
  const deliveryPrice = enrollment.deliveryPrices.find(
    (price) => price.bandKey === routeBandKey,
  );
  if (!deliveryPrice) throw new Error("The delivery renewal price is not ready.");

  let latestCycle:
    | {
        cycle_number: number;
        plan_price_cents: number;
        delivery_price_cents: number;
      }
    | null = null;
  if (!pending) {
    const { data, error: latestCycleError } = await supabase
      .from("bread_club_cycles")
      .select("cycle_number, plan_price_cents, delivery_price_cents")
      .eq("membership_id", membershipId)
      .order("cycle_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestCycleError) throw new Error(latestCycleError.message);
    latestCycle = data;
  }

  const cycleNumber = pending
    ? pending.cycleNumber
    : Number(latestCycle?.cycle_number || 0) + 1;
  const renewalPricing = pending
    ? {
        planPriceCents: pending.planPriceCents,
        deliveryPriceCents: pending.deliveryPriceCents,
        totalCents: pending.totalCents,
      }
    : getBreadClubRenewalPricing({
        currentPlanPriceCents: plan.priceCents,
        currentDeliveryPriceCents: deliveryPrice.priceCents,
        previousPlanPriceCents: latestCycle?.plan_price_cents,
        previousDeliveryPriceCents: latestCycle?.delivery_price_cents,
        applyCurrentPlanPrice: Boolean(membership.pending_plan_id),
        applyCurrentDeliveryPrice:
          membership.pending_route_fee_cents !== null &&
          membership.pending_route_fee_cents !== undefined,
      });
  const stripePeriodStart = membership.stripe_current_period_end
    ? new Date(membership.stripe_current_period_end)
    : now;
  const periodStart = pending
    ? new Date(pending.periodStart)
    : Number.isFinite(stripePeriodStart.getTime()) &&
        stripePeriodStart.getTime() > now.getTime()
      ? stripePeriodStart
      : now;
  const periodEnd = pending
    ? new Date(pending.periodEnd)
    : cycleEndFrom(periodStart);

  return ensureAtomicBreadClubRenewalCycle({
    membershipId,
    cycleNumber,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    planPriceCents: renewalPricing.planPriceCents,
    deliveryPriceCents: renewalPricing.deliveryPriceCents,
    totalCents: renewalPricing.totalCents,
    fulfillments: buildCycleFulfillmentInput(weeks, selection),
  });
}

export async function markBreadClubInvoiceFailed(
  membershipId: string,
  invoiceId: string,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const now = new Date().toISOString();

  const pending = await findPendingCycleForMembership(membershipId);
  if (pending) {
    await supabase
      .from("bread_club_cycles")
      .update({
        status: "past_due",
        stripe_invoice_id: invoiceId,
        updated_at: now,
      })
      .eq("id", pending.id);
  }

  const { error } = await supabase
    .from("bread_club_memberships")
    .update({
      status: "past_due",
      last_payment_failure_at: now,
      updated_at: now,
    })
    .eq("id", membershipId);
  if (error) throw new Error(error.message);
}
