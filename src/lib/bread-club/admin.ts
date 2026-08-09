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
import { requestBreadClubCycleRefund } from "./billing";
import { getSupabaseAdminClient } from "@/lib/supabase";
import type { BreadClubMemberData } from "./types";

export type BreadClubAdminMember = BreadClubMemberData & {
  createdAt: string;
  stripeInvoiceId: string | null;
  lastPaymentFailureAt: string | null;
  estimatedContributionCents: number | null;
  estimatedIngredientCostCents: number | null;
  estimatedStripeFeeCents: number;
  currentCycleRefundStatus?: string | null;
  currentCycleRefundError?: string | null;
  providerSyncRequired: boolean;
  providerSyncError: string | null;
  providerSyncAttemptedAt: string | null;
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
  provider_sync_required: boolean;
  provider_sync_error: string | null;
  provider_sync_attempted_at: string | null;
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
        .select(
          "id, created_at, current_cycle_id, last_payment_failure_at, provider_sync_required, provider_sync_error, provider_sync_attempted_at",
        )
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
        .select(
          "id, stripe_invoice_id, status, stripe_refund_status, refund_last_error",
        )
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
  const billingByCycle = new Map(
    (cycleResult.data || []).map((cycle) => [
      String(cycle.id),
      {
        invoiceId: cycle.stripe_invoice_id
          ? String(cycle.stripe_invoice_id)
          : null,
        refundStatus: cycle.stripe_refund_status
          ? String(cycle.stripe_refund_status)
          : null,
        refundError: cycle.refund_last_error
          ? String(cycle.refund_last_error)
          : null,
      },
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
          ? billingByCycle.get(member.currentCycle.id)?.invoiceId || null
          : null,
        currentCycleRefundStatus: member.currentCycle
          ? billingByCycle.get(member.currentCycle.id)?.refundStatus || null
          : null,
        currentCycleRefundError: member.currentCycle
          ? billingByCycle.get(member.currentCycle.id)?.refundError || null
          : null,
        providerSyncRequired: row.provider_sync_required,
        providerSyncError: row.provider_sync_error,
        providerSyncAttemptedAt: row.provider_sync_attempted_at,
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
  const failedRefunds = (cycleResult.data || []).filter(
    (cycle) =>
      cycle.status === "refund_pending" &&
      ["failed", "canceled", "unknown"].includes(
        String(cycle.stripe_refund_status || ""),
      ),
  ).length;
  if (failedRefunds) {
    urgentIssues.push(
      `${failedRefunds} Bread Club refund${failedRefunds === 1 ? "" : "s"} failed or has an unknown provider result. Retry resumes the durable attempt safely.`,
    );
  }
  const pendingProviderSyncs = members.filter(
    (member) => member.providerSyncRequired,
  );
  if (pendingProviderSyncs.length) {
    const failedProviderSyncs = pendingProviderSyncs.filter(
      (member) => member.providerSyncError,
    ).length;
    urgentIssues.push(
      `${pendingProviderSyncs.length} Bread Club membership change${
        pendingProviderSyncs.length === 1 ? "" : "s"
      } still need${pendingProviderSyncs.length === 1 ? "s" : ""} Stripe synchronization${
        failedProviderSyncs
          ? `; ${failedProviderSyncs} reported a provider error and will retry automatically`
          : ""
      }. Renewals stay blocked until the saved change is confirmed.`,
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
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data: cycle, error: cycleError } = await supabase
    .from("bread_club_cycles")
    .select("id")
    .eq("id", cycleId)
    .eq("membership_id", membershipId)
    .maybeSingle();
  if (cycleError) throw new Error(cycleError.message);
  if (!cycle) throw new Error("That Bread Club cycle was not found.");

  await requestBreadClubCycleRefund(
    cycleId,
    note || "Refund requested by owner",
  );
  return getBreadClubAdminData();
}

export async function syncBreadClubStripeForAdmin() {
  await syncBreadClubStripeCatalog();
  return getBreadClubAdminData();
}
