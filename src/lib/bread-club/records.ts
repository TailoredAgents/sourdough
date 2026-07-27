import { randomBytes } from "crypto";
import type { DeliveryCheckResult } from "@/lib/delivery";
import { ensureRollingWeeklyMenus } from "@/lib/rolling-weeks";
import { getSupabaseAdminClient } from "@/lib/supabase";
import type { DeliveryAddress } from "@/lib/types";
import { getBreadClubEnrollmentData } from "./data";
import {
  getBreadClubCycleTotalCents,
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
  now?: Date;
};

export type PendingBreadClubCheckout = {
  membershipId: string;
  cycleId: string;
  customerId: string;
  checkoutCancelToken: string;
  firstDeliveryAt: string;
  cycleTotalCents: number;
};

function normalizedEmail(email: string) {
  return email.trim().toLowerCase();
}

function cycleEndFrom(date: Date) {
  return new Date(date.getTime() + 28 * 24 * 60 * 60 * 1000);
}

function addressWithContact(
  address: DeliveryAddress,
  email: string,
  phone: string,
) {
  return {
    ...address,
    email: normalizedEmail(email),
    phone,
  };
}

async function findOrCreateCustomer(checkout: BreadClubCheckoutRequest) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const email = normalizedEmail(checkout.customer.email);
  const { data: existing, error: lookupError } = await supabase
    .from("customers")
    .select("id")
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lookupError) throw new Error(lookupError.message);
  if (existing?.id) {
    const { error } = await supabase
      .from("customers")
      .update({
        name: checkout.customer.name,
        phone: checkout.customer.phone,
      })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    return String(existing.id);
  }

  const { data, error } = await supabase
    .from("customers")
    .insert({
      name: checkout.customer.name,
      email,
      phone: checkout.customer.phone,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return String(data.id);
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
  consentIpHash,
  consentVersion,
  deliveryCheck,
  deliveryPrice,
  plan,
  selection,
  weeks,
  now = new Date(),
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

  const customerId = await findOrCreateCustomer(checkout);
  const checkoutCancelToken = randomBytes(24).toString("hex");
  const firstDeliveryAt = weeks[0].deliveryWindow.startsAt;
  const cycleTotalCents = getBreadClubCycleTotalCents(
    plan.priceCents,
    deliveryPrice.priceCents,
  );
  const address = addressWithContact(
    checkout.address,
    checkout.customer.email,
    checkout.customer.phone,
  );

  const { data: membership, error: membershipError } = await supabase
    .from("bread_club_memberships")
    .insert({
      customer_id: customerId,
      plan_id: plan.id,
      status: "pending_checkout",
      default_selection: normalizedSelection.map((item) => ({
        product_id: item.productId,
        quantity: item.quantity,
      })),
      delivery_address: address,
      delivery_instructions: checkout.deliveryInstructions || null,
      delivery_check: deliveryCheck,
      route_fee_cents: Math.round(deliveryPrice.priceCents / 4),
      route_band_key: deliveryPrice.bandKey,
      first_delivery_at: firstDeliveryAt,
      checkout_cancel_token: checkoutCancelToken,
      consent_version: consentVersion,
      consent_text: checkout.consentText,
      consented_at: now.toISOString(),
      consent_ip_hash: consentIpHash,
    })
    .select("id")
    .single();

  if (membershipError) throw new Error(membershipError.message);
  const membershipId = String(membership.id);

  const { data: cycle, error: cycleError } = await supabase
    .from("bread_club_cycles")
    .insert({
      membership_id: membershipId,
      cycle_number: 1,
      status: "pending_payment",
      period_start: now.toISOString(),
      period_end: cycleEndFrom(now).toISOString(),
      plan_price_cents: plan.priceCents,
      delivery_price_cents: deliveryPrice.priceCents,
      tax_cents: 0,
      total_cents: cycleTotalCents,
    })
    .select("id")
    .single();

  if (cycleError) {
    await supabase
      .from("bread_club_memberships")
      .delete()
      .eq("id", membershipId);
    throw new Error(cycleError.message);
  }
  const cycleId = String(cycle.id);

  const { error: reservationError } = await supabase.rpc(
    "reserve_bread_club_cycle",
    {
      p_membership_id: membershipId,
      p_cycle_id: cycleId,
      p_fulfillments: buildCycleFulfillmentInput(
        weeks,
        normalizedSelection,
      ),
    },
  );

  if (reservationError) {
    await supabase
      .from("bread_club_memberships")
      .delete()
      .eq("id", membershipId);
    throw new Error(reservationError.message);
  }

  return {
    membershipId,
    cycleId,
    customerId,
    checkoutCancelToken,
    firstDeliveryAt,
    cycleTotalCents,
  };
}

export async function attachStripeSubscriptionCheckout(
  membershipId: string,
  sessionId: string,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { error } = await supabase
    .from("bread_club_memberships")
    .update({
      stripe_checkout_session_id: sessionId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", membershipId)
    .eq("status", "pending_checkout");
  if (error) throw new Error(error.message);
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
  await releaseBreadClubPendingCycle(cycleId);
  const { error } = await supabase
    .from("bread_club_memberships")
    .update({
      status: "incomplete",
      updated_at: new Date().toISOString(),
    })
    .eq("id", membershipId)
    .eq("status", "pending_checkout");
  if (error) throw new Error(error.message);
}

export async function cancelBreadClubCheckoutByToken(
  membershipId: string,
  token: string,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data: membership, error } = await supabase
    .from("bread_club_memberships")
    .select("id, current_cycle_id")
    .eq("id", membershipId)
    .eq("checkout_cancel_token", token)
    .eq("status", "pending_checkout")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!membership?.current_cycle_id) return false;

  await markBreadClubCheckoutIncomplete(
    membershipId,
    String(membership.current_cycle_id),
  );
  return true;
}

export async function expireBreadClubCheckoutSession(sessionId: string) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data: membership, error } = await supabase
    .from("bread_club_memberships")
    .select("id, current_cycle_id")
    .eq("stripe_checkout_session_id", sessionId)
    .eq("status", "pending_checkout")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!membership?.current_cycle_id) return null;

  await markBreadClubCheckoutIncomplete(
    String(membership.id),
    String(membership.current_cycle_id),
  );
  return String(membership.id);
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

  const { error } = await supabase
    .from("bread_club_memberships")
    .update({
      stripe_checkout_session_id: input.sessionId,
      stripe_customer_id: input.stripeCustomerId,
      stripe_subscription_id: input.stripeSubscriptionId,
      stripe_plan_subscription_item_id:
        input.planSubscriptionItemId || null,
      stripe_delivery_subscription_item_id:
        input.deliverySubscriptionItemId || null,
      stripe_current_period_end: input.currentPeriodEnd || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.membershipId);
  if (error) throw new Error(error.message);
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

export async function findPendingCycleForMembership(membershipId: string) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data, error } = await supabase
    .from("bread_club_cycles")
    .select("id, cycle_number")
    .eq("membership_id", membershipId)
    .in("status", ["pending_payment", "past_due"])
    .order("cycle_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data
    ? { id: String(data.id), cycleNumber: Number(data.cycle_number) }
    : null;
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

  const pending = await findPendingCycleForMembership(membershipId);
  if (pending) return pending;

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

  const { data: latestCycle, error: latestCycleError } = await supabase
    .from("bread_club_cycles")
    .select("cycle_number, plan_price_cents, delivery_price_cents")
    .eq("membership_id", membershipId)
    .order("cycle_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestCycleError) throw new Error(latestCycleError.message);
  const cycleNumber = Number(latestCycle?.cycle_number || 0) + 1;
  const renewalPricing = getBreadClubRenewalPricing({
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
  const periodStart =
    Number.isFinite(stripePeriodStart.getTime()) &&
    stripePeriodStart.getTime() > now.getTime()
      ? stripePeriodStart
      : now;

  const { data: cycle, error: cycleError } = await supabase
    .from("bread_club_cycles")
    .insert({
      membership_id: membershipId,
      cycle_number: cycleNumber,
      status: "pending_payment",
      period_start: periodStart.toISOString(),
      period_end: cycleEndFrom(periodStart).toISOString(),
      plan_price_cents: renewalPricing.planPriceCents,
      delivery_price_cents: renewalPricing.deliveryPriceCents,
      tax_cents: 0,
      total_cents: renewalPricing.totalCents,
    })
    .select("id")
    .single();
  if (cycleError) throw new Error(cycleError.message);

  const cycleId = String(cycle.id);
  const { error: reservationError } = await supabase.rpc(
    "reserve_bread_club_cycle",
    {
      p_membership_id: membershipId,
      p_cycle_id: cycleId,
      p_fulfillments: buildCycleFulfillmentInput(weeks, selection),
    },
  );
  if (reservationError) {
    await supabase.from("bread_club_cycles").delete().eq("id", cycleId);
    throw new Error(reservationError.message);
  }

  return { id: cycleId, cycleNumber };
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
