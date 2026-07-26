import { getBreadClubCatalogData } from "./data";
import { createBreadClubMagicLink } from "./auth";
import { cancelBreadClubMembership } from "./member-actions";
import { getBreadClubMemberData } from "./member-data";
import { syncBreadClubStripeCatalog } from "./stripe-sync";
import {
  estimatePlanContributionCents,
  normalizeBreadClubSelection,
} from "./pricing";
import { isBreadClubPublicEnabled } from "./config";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdminClient } from "@/lib/supabase";
import type { BreadClubMemberData } from "./types";

export type BreadClubAdminMember = BreadClubMemberData & {
  createdAt: string;
  stripeInvoiceId: string | null;
  lastPaymentFailureAt: string | null;
  estimatedContributionCents: number | null;
  estimatedIngredientCostCents: number | null;
  estimatedStripeFeeCents: number;
};

export type BreadClubAdminData = {
  publicEnabled: boolean;
  settings: {
    maxWeeklyLoafSlots: number;
    skipLimitPerCycle: number;
    rolloverCreditDays: number;
    taxStatus: string;
    webhookEndpointId: string | null;
    portalConfigurationId: string | null;
  };
  stripeReady: {
    plans: boolean;
    delivery: boolean;
    webhook: boolean;
    portal: boolean;
  };
  metrics: {
    activeMembers: number;
    recurringRevenueCents: number;
    paymentFailures: number;
    rolloverLoaves: number;
    rolloverDeliveryLiabilityCents: number;
    nextSundayLoafSlots: number;
    nextSundayStops: number;
  };
  nextSunday: {
    label: string;
    production: Array<{
      productName: string;
      quantity: number;
    }>;
  } | null;
  urgentIssues: string[];
  members: BreadClubAdminMember[];
};

type MembershipListRow = {
  id: string;
  created_at: string;
  current_cycle_id: string | null;
  last_payment_failure_at: string | null;
};

export async function getBreadClubAdminData(): Promise<BreadClubAdminData> {
  const supabase = getSupabaseAdminClient();
  const catalog = await getBreadClubCatalogData();
  if (!supabase) {
    return {
      publicEnabled: isBreadClubPublicEnabled(),
      settings: {
        maxWeeklyLoafSlots: catalog.settings.maxWeeklyLoafSlots,
        skipLimitPerCycle: catalog.settings.skipLimitPerCycle,
        rolloverCreditDays: catalog.settings.rolloverCreditDays,
        taxStatus: catalog.settings.taxStatus,
        webhookEndpointId: null,
        portalConfigurationId: null,
      },
      stripeReady: {
        plans: false,
        delivery: false,
        webhook: false,
        portal: false,
      },
      metrics: {
        activeMembers: 0,
        recurringRevenueCents: 0,
        paymentFailures: 0,
        rolloverLoaves: 0,
        rolloverDeliveryLiabilityCents: 0,
        nextSundayLoafSlots: 0,
        nextSundayStops: 0,
      },
      nextSunday: null,
      urgentIssues: ["Supabase admin access is not configured."],
      members: [],
    };
  }

  const [
    membershipResult,
    settingsResult,
    creditResult,
    cycleResult,
    jobResult,
  ] =
    await Promise.all([
      supabase
        .from("bread_club_memberships")
        .select("id, created_at, current_cycle_id, last_payment_failure_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("bread_club_settings")
        .select(
          "max_weekly_loaf_slots, skip_limit_per_cycle, rollover_credit_days, tax_status, stripe_webhook_endpoint_id, stripe_portal_configuration_id",
        )
        .eq("id", true)
        .maybeSingle(),
      supabase
        .from("bread_club_rollover_credits")
        .select(
          "quantity, delivery_fee_credit_cents, stripe_invoice_item_id",
        )
        .eq("status", "available")
        .gt("expires_at", new Date().toISOString()),
      supabase
        .from("bread_club_cycles")
        .select("id, stripe_invoice_id, status")
        .order("cycle_number", { ascending: false }),
      supabase
        .from("bread_club_job_events")
        .select("job_key, last_error")
        .eq("status", "failed")
        .order("updated_at", { ascending: false })
        .limit(20),
    ]);
  if (membershipResult.error) throw new Error(membershipResult.error.message);
  if (settingsResult.error) throw new Error(settingsResult.error.message);
  if (creditResult.error) throw new Error(creditResult.error.message);
  if (cycleResult.error) throw new Error(cycleResult.error.message);
  if (jobResult.error) throw new Error(jobResult.error.message);

  const membershipRows =
    (membershipResult.data || []) as MembershipListRow[];
  const memberData = await Promise.all(
    membershipRows.map((row) => getBreadClubMemberData(row.id)),
  );
  const invoiceByCycle = new Map(
    (cycleResult.data || []).map((cycle) => [
      String(cycle.id),
      cycle.stripe_invoice_id
        ? String(cycle.stripe_invoice_id)
        : null,
    ]),
  );
  const members = memberData
    .map((member, index): BreadClubAdminMember | null => {
      if (!member) return null;
      const row = membershipRows[index];
      const nextSelection =
        member.fulfillments.find(
          (fulfillment) => fulfillment.status === "scheduled",
        )?.selection || [];
      const contribution = estimatePlanContributionCents(
        member.plan,
        normalizeBreadClubSelection(nextSelection),
      );
      return {
        ...member,
        createdAt: row.created_at,
        stripeInvoiceId: member.currentCycle
          ? invoiceByCycle.get(member.currentCycle.id) || null
          : null,
        lastPaymentFailureAt: row.last_payment_failure_at,
        estimatedContributionCents: contribution.contributionCents,
        estimatedIngredientCostCents:
          contribution.ingredientCostCents,
        estimatedStripeFeeCents: contribution.stripeFeeCents,
      };
    })
    .filter((member): member is BreadClubAdminMember => Boolean(member));

  const activeMembers = members.filter((member) =>
    ["active", "past_due", "canceling"].includes(member.status),
  );
  const upcomingFulfillments = activeMembers.flatMap((member) =>
    member.fulfillments
      .filter(
        (fulfillment) =>
          fulfillment.status === "scheduled" &&
          new Date(fulfillment.deliveryStartsAt).getTime() > Date.now(),
      )
      .map((fulfillment) => ({ member, fulfillment })),
  );
  const firstStart = upcomingFulfillments
    .map(({ fulfillment }) => new Date(fulfillment.deliveryStartsAt).getTime())
    .sort((left, right) => left - right)[0];
  const nextSundayRows = firstStart
    ? upcomingFulfillments.filter(
        ({ fulfillment }) =>
          new Date(fulfillment.deliveryStartsAt).getTime() === firstStart,
      )
    : [];
  const production = new Map<string, number>();
  for (const { fulfillment } of nextSundayRows) {
    for (const item of fulfillment.items) {
      production.set(
        item.productName,
        (production.get(item.productName) || 0) + item.quantity,
      );
    }
  }

  const settings = settingsResult.data;
  const plansReady = catalog.plans.every(
    (plan) =>
      plan.stripeProductId &&
      plan.stripePriceId &&
      plan.stripePriceCents === plan.priceCents,
  );
  const deliveryReady = catalog.deliveryPrices.every(
    (price) =>
      price.stripeProductId &&
      price.stripePriceId &&
      price.stripePriceCents === price.priceCents,
  );
  const webhookReady = Boolean(settings?.stripe_webhook_endpoint_id);
  const portalReady = Boolean(settings?.stripe_portal_configuration_id);
  const urgentIssues: string[] = [];
  if (settings?.tax_status === "pending") {
    urgentIssues.push(
      "Georgia sales-tax treatment is still pending. Keep public enrollment disabled.",
    );
  }
  if (!plansReady || !deliveryReady) {
    urgentIssues.push("Bread Club recurring Stripe prices need synchronization.");
  }
  if (!webhookReady) {
    urgentIssues.push("The live Bread Club Stripe webhook is not recorded.");
  }
  if (!portalReady) {
    urgentIssues.push("Stripe Billing Portal configuration is not recorded.");
  }
  const failureCount = activeMembers.filter(
    (member) => member.status === "past_due",
  ).length;
  if (failureCount) {
    urgentIssues.push(
      `${failureCount} membership payment${failureCount === 1 ? "" : "s"} need attention.`,
    );
  }
  const unreconciledCredits = (creditResult.data || []).filter(
    (credit) => !credit.stripe_invoice_item_id,
  ).length;
  if (unreconciledCredits) {
    urgentIssues.push(
      `${unreconciledCredits} skip delivery credit${unreconciledCredits === 1 ? "" : "s"} need Stripe reconciliation.`,
    );
  }
  if (jobResult.data?.length) {
    urgentIssues.push(
      `${jobResult.data.length} Bread Club background job${
        jobResult.data.length === 1 ? "" : "s"
      } need attention. Latest: ${
        jobResult.data[0].last_error || jobResult.data[0].job_key
      }`,
    );
  }
  const pendingRefunds = (cycleResult.data || []).filter(
    (cycle) => cycle.status === "refund_pending",
  ).length;
  if (pendingRefunds) {
    urgentIssues.push(
      `${pendingRefunds} Bread Club refund${pendingRefunds === 1 ? "" : "s"} need to be resumed.`,
    );
  }

  return {
    publicEnabled: isBreadClubPublicEnabled(),
    settings: {
      maxWeeklyLoafSlots:
        settings?.max_weekly_loaf_slots ??
        catalog.settings.maxWeeklyLoafSlots,
      skipLimitPerCycle:
        settings?.skip_limit_per_cycle ??
        catalog.settings.skipLimitPerCycle,
      rolloverCreditDays:
        settings?.rollover_credit_days ??
        catalog.settings.rolloverCreditDays,
      taxStatus: String(
        settings?.tax_status || catalog.settings.taxStatus,
      ),
      webhookEndpointId: settings?.stripe_webhook_endpoint_id
        ? String(settings.stripe_webhook_endpoint_id)
        : null,
      portalConfigurationId: settings?.stripe_portal_configuration_id
        ? String(settings.stripe_portal_configuration_id)
        : null,
    },
    stripeReady: {
      plans: plansReady,
      delivery: deliveryReady,
      webhook: webhookReady,
      portal: portalReady,
    },
    metrics: {
      activeMembers: activeMembers.length,
      recurringRevenueCents: activeMembers.reduce(
        (sum, member) =>
          sum + Number(member.currentCycle?.totalCents || 0),
        0,
      ),
      paymentFailures: failureCount,
      rolloverLoaves: (creditResult.data || []).reduce(
        (sum, credit) => sum + Number(credit.quantity),
        0,
      ),
      rolloverDeliveryLiabilityCents: (
        creditResult.data || []
      ).reduce(
        (sum, credit) =>
          sum + Number(credit.delivery_fee_credit_cents),
        0,
      ),
      nextSundayLoafSlots: nextSundayRows.reduce(
        (sum, row) =>
          sum +
          row.fulfillment.items.reduce(
            (itemSum, item) => itemSum + item.quantity,
            0,
          ),
        0,
      ),
      nextSundayStops: nextSundayRows.length,
    },
    nextSunday: firstStart
      ? {
          label:
            nextSundayRows[0]?.fulfillment.deliveryLabel ||
            "Sunday 3:00-6:00 PM",
          production: Array.from(
            production,
            ([productName, quantity]) => ({
              productName,
              quantity,
            }),
          ).sort((left, right) =>
            left.productName.localeCompare(right.productName),
          ),
        }
      : null,
    urgentIssues,
    members,
  };
}

export async function updateBreadClubCapacity(maxWeeklyLoafSlots: number) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { error } = await supabase
    .from("bread_club_settings")
    .update({
      max_weekly_loaf_slots: maxWeeklyLoafSlots,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
  if (error) throw new Error(error.message);
  return getBreadClubAdminData();
}

export async function resendBreadClubAccess(
  membershipId: string,
) {
  const member = await getBreadClubMemberData(membershipId);
  if (!member) throw new Error("Bread Club membership was not found.");
  await createBreadClubMagicLink(member.customerEmail, null);
  return getBreadClubAdminData();
}

export async function adminCancelBreadClubMembership(
  membershipId: string,
  reason: string,
) {
  await cancelBreadClubMembership(membershipId, reason);
  return getBreadClubAdminData();
}

export async function refundBreadClubCycle(
  membershipId: string,
  cycleId: string,
  note: string,
) {
  const stripe = getStripe();
  const supabase = getSupabaseAdminClient();
  if (!stripe) throw new Error("Stripe is not configured.");
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data: cycle, error: cycleError } = await supabase
    .from("bread_club_cycles")
    .select("stripe_invoice_id, total_cents, status")
    .eq("id", cycleId)
    .eq("membership_id", membershipId)
    .maybeSingle();
  if (cycleError) throw new Error(cycleError.message);
  if (
    !cycle?.stripe_invoice_id ||
    !["paid", "refund_pending", "refunded"].includes(String(cycle.status))
  ) {
    throw new Error("A paid Stripe invoice was not found for this cycle.");
  }
  if (cycle.status === "refunded") return getBreadClubAdminData();

  const { data: fulfillments, error: fulfillmentError } = await supabase
    .from("bread_club_fulfillments")
    .select("id")
    .eq("cycle_id", cycleId)
    .eq("membership_id", membershipId);
  if (fulfillmentError) throw new Error(fulfillmentError.message);
  const fulfillmentIds = (fulfillments || []).map((item) => item.id);
  const { data: credits, error: creditError } = fulfillmentIds.length
    ? await supabase
        .from("bread_club_rollover_credits")
        .select(
          "id, status, stripe_invoice_item_id, delivery_credit_applied_at",
        )
        .in("source_fulfillment_id", fulfillmentIds)
    : { data: [], error: null };
  if (creditError) throw new Error(creditError.message);
  if (
    (credits || []).some(
      (credit) =>
        credit.status === "redeemed" ||
        Boolean(credit.delivery_credit_applied_at),
    )
  ) {
    throw new Error(
      "A rollover or delivery credit from this cycle was already used. Review it in Stripe before issuing a manual refund.",
    );
  }

  const { data: previousStatus, error: beginError } = await supabase.rpc(
    "begin_bread_club_cycle_refund",
    { p_cycle_id: cycleId },
  );
  if (beginError) throw new Error(beginError.message);
  if (previousStatus === "refunded") return getBreadClubAdminData();

  for (const credit of credits || []) {
    if (!credit.stripe_invoice_item_id) continue;
    try {
      await stripe.invoiceItems.del(
        String(credit.stripe_invoice_item_id),
      );
    } catch (error) {
      const code =
        typeof error === "object" && error && "code" in error
          ? String(error.code)
          : "";
      if (code === "resource_missing") continue;
      if (previousStatus === "paid" || previousStatus === "past_due") {
        await supabase
          .from("bread_club_cycles")
          .update({
            status: previousStatus,
            updated_at: new Date().toISOString(),
          })
          .eq("id", cycleId)
          .eq("status", "refund_pending");
      }
      throw error;
    }
  }

  const payments = await stripe.invoicePayments.list({
    invoice: String(cycle.stripe_invoice_id),
    status: "paid",
    limit: 10,
  });
  const payment = payments.data.find((item) => item.status === "paid");
  const paymentIntent =
    typeof payment?.payment.payment_intent === "string"
      ? payment.payment.payment_intent
      : payment?.payment.payment_intent?.id;
  const charge =
    typeof payment?.payment.charge === "string"
      ? payment.payment.charge
      : payment?.payment.charge?.id;
  if (!paymentIntent && !charge) {
    throw new Error("The invoice payment cannot be refunded automatically.");
  }

  const refund = await stripe.refunds.create(
    {
      ...(paymentIntent
        ? { payment_intent: paymentIntent }
        : { charge: charge! }),
      amount: Number(cycle.total_cents),
      reason: "requested_by_customer",
      metadata: {
        bread_club_membership_id: membershipId,
        bread_club_cycle_id: cycleId,
      },
    },
    { idempotencyKey: `bread-club-cycle-refund-${cycleId}` },
  );

  const { error: refundError } = await supabase.rpc(
    "refund_bread_club_cycle",
    {
      p_cycle_id: cycleId,
      p_stripe_refund_id: refund.id,
      p_admin_note: note || "Refunded by owner",
    },
  );
  if (refundError) throw new Error(refundError.message);
  return getBreadClubAdminData();
}

export async function syncBreadClubStripeForAdmin() {
  await syncBreadClubStripeCatalog();
  return getBreadClubAdminData();
}
