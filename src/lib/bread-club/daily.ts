import type Stripe from "stripe";
import { ensureRollingWeeklyMenus } from "@/lib/rolling-weeks";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { getSiteUrl } from "@/lib/utils";
import { getBreadClubAdminData } from "./admin";
import {
  sendBreadClubFridaySummary,
  sendBreadClubSelectionReminder,
} from "./emails";
import { getBreadClubMemberData } from "./member-data";
import {
  reconcileBreadClubPendingRefunds,
  refundBreadClubUnusedCredits,
} from "./billing";
import {
  expireBreadClubCheckoutSession,
  findPendingCycleForMembership,
  markBreadClubCheckoutIncomplete,
  prepareNextBreadClubCycle,
  releaseBreadClubPendingCycle,
} from "./records";
import {
  completeBreadClubAddonCheckout,
  expireBreadClubAddonCheckout,
  expireUnattachedBreadClubAddonCheckout,
} from "./member-actions";
import { reconcilePendingBreadClubProviderChanges } from "./provider-sync";
import {
  reconcileBreadClubSubscriptionCheckout,
  type BreadClubSubscriptionCheckoutReconciliation,
} from "./webhook";

type DailyReport = {
  generatedMenuIds: string[];
  preparedCycleIds: string[];
  remindersSent: number;
  fridaySummarySent: boolean;
  creditsExpired: number;
  creditsReconciled: number;
  canceledCreditsRefunded: number;
  completedSubscriptionCheckoutsReconciled: number;
  paidSubscriptionCyclesRecovered: number;
  providerChangesSucceeded: number;
  providerChangesDeferred: number;
  refundsReconciled: number;
  refundsDeferred: number;
  staleCheckoutsReleased: number;
  staleAddonsReleased: number;
  fulfillmentsCompleted: number;
  membershipsReconciled: number;
  errors: string[];
};

type MembershipRow = {
  id: string;
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_current_period_end: string | null;
  cancel_at_period_end: boolean;
  provider_sync_required: boolean;
};

type PendingCheckoutRow = {
  id: string;
  current_cycle_id: string | null;
  stripe_checkout_session_id: string | null;
  checkout_expires_at: string | null;
  created_at: string;
};

export type DailySubscriptionCheckoutRecovery =
  | { outcome: "not_due" | "deferred" | "unchanged" }
  | { outcome: "released" }
  | {
      outcome: "completed";
      reconciliation: BreadClubSubscriptionCheckoutReconciliation;
    };

function localDateKey(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function localWeekday(now: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(now);
}

function formatCutoff(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

async function claimJob(
  jobKey: string,
  jobType: string,
  membershipId: string | null,
  payload: Record<string, unknown>,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { data, error } = await supabase.rpc("claim_bread_club_job", {
    p_job_key: jobKey,
    p_job_type: jobType,
    p_membership_id: membershipId,
    p_payload: payload,
  });
  if (error) throw new Error(error.message);
  return data ? String(data) : null;
}

async function finishJob(
  jobKey: string,
  claimToken: string,
  status: "completed" | "failed",
  error?: unknown,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return;
  const { error: finishError } = await supabase.rpc("finish_bread_club_job", {
    p_job_key: jobKey,
    p_claim_token: claimToken,
    p_status: status,
    p_error_message:
      status === "failed"
        ? error instanceof Error
          ? error.message
          : String(error || "Job failed.")
        : null,
  });
  if (finishError) throw new Error(finishError.message);
}

export function subscriptionDetails(
  subscription: Stripe.Subscription,
  now = new Date(),
) {
  const planItem = subscription.items.data.find((item) =>
    Boolean(item.price.metadata.bread_club_plan_id),
  );
  const deliveryItem = subscription.items.data.find((item) =>
    Boolean(item.price.metadata.bread_club_delivery_band),
  );
  const periodEnd = subscription.items.data.reduce(
    (latest, item) => Math.max(latest, item.current_period_end || 0),
    0,
  );
  const status =
    subscription.status === "canceled"
      ? "canceled"
      : subscription.status === "past_due" ||
          subscription.status === "unpaid"
        ? "past_due"
        : subscription.cancel_at_period_end
          ? "canceling"
          : subscription.status === "active" ||
              subscription.status === "trialing"
            ? "active"
            : "incomplete";
  const canceledAt =
    status === "canceled"
      ? new Date(
          (subscription.canceled_at || Math.floor(now.getTime() / 1000)) *
            1000,
        ).toISOString()
      : null;

  return {
    planItemId: planItem?.id || null,
    deliveryItemId: deliveryItem?.id || null,
    periodEnd:
      periodEnd > 0 ? new Date(periodEnd * 1000).toISOString() : null,
    status,
    cancelAtPeriodEnd:
      status === "canceled" || subscription.cancel_at_period_end,
    canceledAt,
  };
}

export async function reconcileStaleBreadClubSubscriptionCheckout(
  membership: PendingCheckoutRow,
  now: Date,
): Promise<DailySubscriptionCheckoutRecovery> {
  if (!membership.current_cycle_id) return { outcome: "unchanged" };

  const knownExpiry = membership.checkout_expires_at
    ? new Date(membership.checkout_expires_at).getTime()
    : Number.NaN;
  const createdAt = new Date(membership.created_at).getTime();
  const legacySafeAge =
    Number.isFinite(createdAt) &&
    now.getTime() - createdAt >= 26 * 60 * 60 * 1000;
  const reachedSafeExpiry = Number.isFinite(knownExpiry)
    ? knownExpiry <= now.getTime()
    : legacySafeAge;

  const membershipId = String(membership.id);
  const cycleId = String(membership.current_cycle_id);
  const sessionId = membership.stripe_checkout_session_id
    ? String(membership.stripe_checkout_session_id)
    : null;
  if (!sessionId) {
    if (!reachedSafeExpiry) return { outcome: "not_due" };
    const released = await markBreadClubCheckoutIncomplete(
      membershipId,
      cycleId,
    );
    return released ? { outcome: "released" } : { outcome: "unchanged" };
  }

  const stripe = getStripe();
  if (!stripe) return { outcome: "deferred" };
  let session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.status === "complete") {
    const reconciliation =
      await reconcileBreadClubSubscriptionCheckout(session, {
        membershipId,
        cycleId,
      });
    return { outcome: "completed", reconciliation };
  }
  if (!reachedSafeExpiry) return { outcome: "not_due" };
  if (session.status === "open") {
    try {
      session = await stripe.checkout.sessions.expire(sessionId);
    } catch {
      session = await stripe.checkout.sessions.retrieve(sessionId);
    }
  }
  if (session.status !== "expired") return { outcome: "unchanged" };

  const releasedMembershipId = await expireBreadClubCheckoutSession(
    session.id,
    membershipId,
  );
  return releasedMembershipId
    ? { outcome: "released" }
    : { outcome: "unchanged" };
}

async function expireBreadClubCredits(report: DailyReport, now: Date) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const nowIso = now.toISOString();

  const { data: expiredCredits, error: creditLookupError } = await supabase
    .from("bread_club_rollover_credits")
    .select("id")
    .eq("status", "available")
    .lte("expires_at", nowIso);
  if (creditLookupError) throw new Error(creditLookupError.message);
  const expiredCreditIds = (expiredCredits || []).map((row) => row.id);
  if (expiredCreditIds.length) {
    const { error } = await supabase
      .from("bread_club_rollover_credits")
      .update({ status: "expired", updated_at: nowIso })
      .in("id", expiredCreditIds)
      .eq("status", "available");
    if (error) throw new Error(error.message);
  }
  report.creditsExpired = expiredCreditIds.length;
}

async function cleanupExpiredState(report: DailyReport, now: Date) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const nowIso = now.toISOString();

  await supabase
    .from("bread_club_magic_links")
    .delete()
    .lt("expires_at", nowIso);
  await supabase
    .from("bread_club_sessions")
    .delete()
    .lt("expires_at", nowIso);

  const staleCheckoutBefore = new Date(
    now.getTime() - 45 * 60 * 1000,
  ).toISOString();
  const { data: staleMemberships, error: staleMembershipError } =
    await supabase
      .from("bread_club_memberships")
      .select(
        "id, current_cycle_id, stripe_checkout_session_id, checkout_expires_at, created_at",
      )
      .eq("status", "pending_checkout")
      .lt("created_at", staleCheckoutBefore);
  if (staleMembershipError) throw new Error(staleMembershipError.message);
  for (const membership of staleMemberships || []) {
    const recovery = await reconcileStaleBreadClubSubscriptionCheckout(
      membership as PendingCheckoutRow,
      now,
    );
    if (recovery.outcome === "released") {
      report.staleCheckoutsReleased += 1;
    }
    if (recovery.outcome === "completed") {
      report.completedSubscriptionCheckoutsReconciled += 1;
      if (recovery.reconciliation.cycleState === "activated") {
        report.paidSubscriptionCyclesRecovered += 1;
      }
    }
  }

  const staleAddonBefore = new Date(
    now.getTime() - 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data: staleAddons, error: staleAddonError } = await supabase
    .from("bread_club_addon_checkouts")
    .select("id, stripe_checkout_session_id")
    .eq("status", "pending_payment")
    .lt("created_at", staleAddonBefore);
  if (staleAddonError) throw new Error(staleAddonError.message);
  for (const addon of staleAddons || []) {
    const sessionId = addon.stripe_checkout_session_id
      ? String(addon.stripe_checkout_session_id)
      : null;
    if (!sessionId) {
      if (await expireUnattachedBreadClubAddonCheckout(String(addon.id))) {
        report.staleAddonsReleased += 1;
      }
      continue;
    }
    const stripe = getStripe();
    if (!stripe) continue;
    let session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.status === "complete") {
      await completeBreadClubAddonCheckout(session);
      continue;
    }
    if (session.status === "open") {
      try {
        session = await stripe.checkout.sessions.expire(sessionId);
      } catch {
        session = await stripe.checkout.sessions.retrieve(sessionId);
      }
    }
    if (
      session.status === "expired" &&
      (await expireBreadClubAddonCheckout(session.id, String(addon.id)))
    ) {
      report.staleAddonsReleased += 1;
    }
  }
}

async function reconcileFulfillments(report: DailyReport) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { data, error } = await supabase
    .from("bread_club_fulfillments")
    .select(
      "id, cycle_id, orders!bread_club_fulfillments_order_id_fkey(status)",
    )
    .eq("status", "scheduled");
  if (error) throw new Error(error.message);

  const completedCycleIds = new Set<string>();
  for (const row of data || []) {
    const order = Array.isArray(row.orders) ? row.orders[0] : row.orders;
    if (order?.status !== "delivered") continue;
    const { error: updateError } = await supabase
      .from("bread_club_fulfillments")
      .update({ status: "fulfilled", updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "scheduled");
    if (updateError) throw new Error(updateError.message);
    report.fulfillmentsCompleted += 1;
    completedCycleIds.add(String(row.cycle_id));
  }

  for (const cycleId of completedCycleIds) {
    const { data: remaining, error: remainingError } = await supabase
      .from("bread_club_fulfillments")
      .select("id", { count: "exact" })
      .eq("cycle_id", cycleId)
      .in("status", ["pending_payment", "scheduled"])
      .limit(1);
    if (remainingError) throw new Error(remainingError.message);
    if (remaining?.length) continue;
    const { error: cycleError } = await supabase
      .from("bread_club_cycles")
      .update({ status: "completed", updated_at: new Date().toISOString() })
      .eq("id", cycleId)
      .eq("status", "paid");
    if (cycleError) throw new Error(cycleError.message);
  }
}

export type CanceledCreditRefundReconciliation = {
  membershipsAttempted: number;
  creditsRefunded: number;
  errors: string[];
};

export async function reconcileCanceledBreadClubCreditRefunds(
  now: Date,
): Promise<CanceledCreditRefundReconciliation> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { data, error } = await supabase
    .from("bread_club_rollover_credits")
    .select(
      "membership_id, expires_at, bread_club_memberships!inner(status, canceled_at)",
    )
    .in("status", ["available", "expired"])
    .eq("bread_club_memberships.status", "canceled");
  if (error) throw new Error(error.message);

  const membershipIds = new Set(
    (data || [])
      .filter((credit) => {
        const membership = Array.isArray(credit.bread_club_memberships)
          ? credit.bread_club_memberships[0]
          : credit.bread_club_memberships;
        const canceledAt = new Date(
          String(membership?.canceled_at || ""),
        ).getTime();
        const expiresAt = new Date(String(credit.expires_at)).getTime();
        return (
          Number.isFinite(canceledAt) &&
          Number.isFinite(expiresAt) &&
          canceledAt <= now.getTime() &&
          canceledAt < expiresAt
        );
      })
      .map((credit) => String(credit.membership_id)),
  );
  const result: CanceledCreditRefundReconciliation = {
    membershipsAttempted: 0,
    creditsRefunded: 0,
    errors: [],
  };
  for (const membershipId of membershipIds) {
    result.membershipsAttempted += 1;
    try {
      const refunds = await refundBreadClubUnusedCredits(membershipId);
      result.creditsRefunded += refunds.filter(
        (refund) => refund.state === "refunded",
      ).length;
    } catch (refundError) {
      result.errors.push(
        `Canceled membership ${membershipId} credits: ${
          refundError instanceof Error
            ? refundError.message
            : "refund failed"
        }`,
      );
    }
  }
  return result;
}

async function reconcileCredits(report: DailyReport, now: Date) {
  const stripe = getStripe();
  const supabase = getSupabaseAdminClient();
  if (!stripe || !supabase) return;

  const { data, error } = await supabase
    .from("bread_club_rollover_credits")
    .select(
      "id, membership_id, delivery_fee_credit_cents, bread_club_memberships(status, stripe_customer_id, stripe_subscription_id)",
    )
    .eq("status", "available")
    .gt("expires_at", now.toISOString())
    .is("stripe_invoice_item_id", null);
  if (error) throw new Error(error.message);

  for (const credit of data || []) {
    const membership = Array.isArray(credit.bread_club_memberships)
      ? credit.bread_club_memberships[0]
      : credit.bread_club_memberships;
    if (
      !membership?.stripe_customer_id ||
      !membership.stripe_subscription_id ||
      !["active", "past_due", "canceling"].includes(
        String(membership.status),
      )
    ) {
      continue;
    }
    const jobKey = `credit-invoice-item:${credit.id}`;
    const claimToken = await claimJob(
      jobKey,
      "credit_reconciliation",
      String(credit.membership_id),
      { creditId: credit.id },
    );
    if (!claimToken) continue;
    try {
      const invoiceItem = await stripe.invoiceItems.create(
        {
          customer: String(membership.stripe_customer_id),
          subscription: String(membership.stripe_subscription_id),
          amount: -Number(credit.delivery_fee_credit_cents),
          currency: "usd",
          description: "Bread Club skipped-delivery credit",
          discountable: false,
          metadata: {
            bread_club_membership_id: String(credit.membership_id),
            bread_club_rollover_credit_id: String(credit.id),
          },
        },
        { idempotencyKey: `bread-club-credit-${credit.id}` },
      );
      const { error: updateError } = await supabase
        .from("bread_club_rollover_credits")
        .update({
          stripe_invoice_item_id: invoiceItem.id,
          updated_at: now.toISOString(),
        })
        .eq("id", credit.id)
        .is("stripe_invoice_item_id", null);
      if (updateError) throw new Error(updateError.message);
      await finishJob(jobKey, claimToken, "completed");
      report.creditsReconciled += 1;
    } catch (creditError) {
      await finishJob(jobKey, claimToken, "failed", creditError);
      report.errors.push(
        `Credit ${credit.id}: ${
          creditError instanceof Error
            ? creditError.message
            : "reconciliation failed"
        }`,
      );
    }
  }
}

async function reconcileMemberships(report: DailyReport, now: Date) {
  const stripe = getStripe();
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { data, error } = await supabase
    .from("bread_club_memberships")
    .select(
      "id, status, stripe_customer_id, stripe_subscription_id, stripe_current_period_end, cancel_at_period_end, provider_sync_required",
    )
    .in("status", ["active", "past_due", "canceling"]);
  if (error) throw new Error(error.message);

  for (const membership of (data || []) as MembershipRow[]) {
    try {
      let periodEnd = membership.stripe_current_period_end;
      let status = membership.status;
      let cancelAtPeriodEnd = membership.cancel_at_period_end;
      if (stripe && membership.stripe_subscription_id) {
        const subscription = await stripe.subscriptions.retrieve(
          membership.stripe_subscription_id,
        );
        const details = subscriptionDetails(subscription, now);
        periodEnd = details.periodEnd;
        status = details.status;
        cancelAtPeriodEnd = details.cancelAtPeriodEnd;
        if (status === "canceled") {
          const pending = await findPendingCycleForMembership(
            String(membership.id),
          );
          if (pending) await releaseBreadClubPendingCycle(pending.id);
        }
        const { error: updateError } = await supabase
          .from("bread_club_memberships")
          .update({
            status,
            cancel_at_period_end: cancelAtPeriodEnd,
            canceled_at: details.canceledAt,
            stripe_plan_subscription_item_id: details.planItemId,
            stripe_delivery_subscription_item_id: details.deliveryItemId,
            stripe_current_period_end: periodEnd,
            updated_at: now.toISOString(),
          })
          .eq("id", membership.id);
        if (updateError) throw new Error(updateError.message);
        report.membershipsReconciled += 1;
      }

      if (
        status === "active" &&
        !cancelAtPeriodEnd &&
        !membership.provider_sync_required &&
        periodEnd &&
        new Date(periodEnd).getTime() <=
          now.getTime() + 7 * 24 * 60 * 60 * 1000
      ) {
        const cycle = await prepareNextBreadClubCycle(
          String(membership.id),
          now,
        );
        if (!report.preparedCycleIds.includes(cycle.id)) {
          report.preparedCycleIds.push(cycle.id);
        }
      }
    } catch (membershipError) {
      report.errors.push(
        `Membership ${membership.id}: ${
          membershipError instanceof Error
            ? membershipError.message
            : "reconciliation failed"
        }`,
      );
    }
  }
}

async function sendReminders(report: DailyReport, now: Date) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { data, error } = await supabase
    .from("bread_club_memberships")
    .select("id")
    .in("status", ["active", "canceling"]);
  if (error) throw new Error(error.message);
  const minimum = now.getTime() + 24 * 60 * 60 * 1000;
  const maximum = now.getTime() + 60 * 60 * 60 * 1000;

  for (const row of data || []) {
    const member = await getBreadClubMemberData(String(row.id));
    if (!member) continue;
    const fulfillment = member.fulfillments.find((item) => {
      const cutoff = new Date(item.cutoffAt).getTime();
      return (
        item.status === "scheduled" &&
        cutoff >= minimum &&
        cutoff <= maximum
      );
    });
    if (!fulfillment) continue;

    const jobKey = `selection-reminder:${fulfillment.id}`;
    const claimToken = await claimJob(
      jobKey,
      "selection_reminder",
      member.id,
      { fulfillmentId: fulfillment.id },
    );
    if (!claimToken) continue;
    try {
      const selection = fulfillment.items
        .map((item) => `${item.quantity} x ${item.productName}`)
        .join(", ");
      await sendBreadClubSelectionReminder({
        to: member.customerEmail,
        customerName: member.customerName,
        membershipId: member.id,
        deliveryLabel: fulfillment.deliveryLabel,
        selection,
        cutoffLabel: formatCutoff(fulfillment.cutoffAt),
        manageUrl: `${getSiteUrl()}/bread-club/manage`,
        eventKey: jobKey,
      });
      await finishJob(jobKey, claimToken, "completed");
      report.remindersSent += 1;
    } catch (reminderError) {
      await finishJob(jobKey, claimToken, "failed", reminderError);
      report.errors.push(
        `Reminder ${fulfillment.id}: ${
          reminderError instanceof Error
            ? reminderError.message
            : "send failed"
        }`,
      );
    }
  }
}

async function sendFridaySummary(report: DailyReport, now: Date) {
  if (localWeekday(now) !== "Fri") return;
  const recipient =
    process.env.BAKERY_EMAIL || process.env.OWNER_ALERT_EMAIL;
  if (!recipient) return;
  const admin = await getBreadClubAdminData();
  if (!admin.nextSunday) return;
  const jobKey = `friday-summary:${localDateKey(now)}`;
  const claimToken = await claimJob(
    jobKey,
    "friday_summary",
    null,
    { deliveryLabel: admin.nextSunday.label },
  );
  if (!claimToken) return;
  try {
    await sendBreadClubFridaySummary({
      to: recipient,
      deliveryLabel: admin.nextSunday.label,
      productionLines: admin.nextSunday.production.map(
        (item) => `${item.quantity} x ${item.productName}`,
      ),
      memberCount: admin.metrics.nextSundayStops,
      eventKey: jobKey,
    });
    await finishJob(jobKey, claimToken, "completed");
    report.fridaySummarySent = true;
  } catch (summaryError) {
    await finishJob(jobKey, claimToken, "failed", summaryError);
    report.errors.push(
      `Friday summary: ${
        summaryError instanceof Error ? summaryError.message : "send failed"
      }`,
    );
  }
}

export async function runBreadClubDaily(now = new Date()): Promise<DailyReport> {
  const report: DailyReport = {
    generatedMenuIds: [],
    preparedCycleIds: [],
    remindersSent: 0,
    fridaySummarySent: false,
    creditsExpired: 0,
    creditsReconciled: 0,
    canceledCreditsRefunded: 0,
    completedSubscriptionCheckoutsReconciled: 0,
    paidSubscriptionCyclesRecovered: 0,
    providerChangesSucceeded: 0,
    providerChangesDeferred: 0,
    refundsReconciled: 0,
    refundsDeferred: 0,
    staleCheckoutsReleased: 0,
    staleAddonsReleased: 0,
    fulfillmentsCompleted: 0,
    membershipsReconciled: 0,
    errors: [],
  };

  report.generatedMenuIds = await ensureRollingWeeklyMenus(now);
  await cleanupExpiredState(report, now);
  await reconcileFulfillments(report);
  const providerChanges =
    await reconcilePendingBreadClubProviderChanges();
  report.providerChangesSucceeded = providerChanges.succeeded;
  report.providerChangesDeferred = providerChanges.deferred;
  report.errors.push(
    ...providerChanges.errors.map((error) => `Provider sync ${error}`),
  );
  await reconcileMemberships(report, now);
  const canceledCreditRefunds =
    await reconcileCanceledBreadClubCreditRefunds(now);
  report.canceledCreditsRefunded = canceledCreditRefunds.creditsRefunded;
  report.errors.push(...canceledCreditRefunds.errors);
  await expireBreadClubCredits(report, now);
  const pendingRefunds = await reconcileBreadClubPendingRefunds();
  const refundOutcomes = [
    ...pendingRefunds.creditOutcomes,
    ...pendingRefunds.cycleOutcomes,
  ];
  report.refundsReconciled = refundOutcomes.filter(
    (refund) => refund.state === "refunded",
  ).length;
  report.refundsDeferred = refundOutcomes.filter(
    (refund) => refund.state === "refund_pending",
  ).length + pendingRefunds.errors.length;
  report.errors.push(
    ...pendingRefunds.errors.map((error) =>
      `Refund reconciliation ${error}`,
    ),
  );
  await reconcileCredits(report, now);
  await sendReminders(report, now);
  await sendFridaySummary(report, now);
  return report;
}
