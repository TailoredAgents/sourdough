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
  markBreadClubCheckoutIncomplete,
  prepareNextBreadClubCycle,
} from "./records";

type DailyReport = {
  generatedMenuIds: string[];
  preparedCycleIds: string[];
  remindersSent: number;
  fridaySummarySent: boolean;
  creditsExpired: number;
  creditsReconciled: number;
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
  now: Date,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { error: insertError } = await supabase
    .from("bread_club_job_events")
    .insert({
      job_key: jobKey,
      job_type: jobType,
      membership_id: membershipId,
      status: "processing",
      payload,
      started_at: now.toISOString(),
      updated_at: now.toISOString(),
    });
  if (!insertError) return true;
  if (insertError.code !== "23505") throw new Error(insertError.message);

  const { data: existing, error: lookupError } = await supabase
    .from("bread_club_job_events")
    .select("status, attempt_count, updated_at")
    .eq("job_key", jobKey)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (!existing || existing.status === "completed") return false;

  const staleBefore = now.getTime() - 15 * 60 * 1000;
  const isStale =
    new Date(existing.updated_at).getTime() < staleBefore;
  if (existing.status !== "failed" && !isStale) return false;

  const { data: reclaimed, error: reclaimError } = await supabase
    .from("bread_club_job_events")
    .update({
      status: "processing",
      attempt_count: Number(existing.attempt_count) + 1,
      last_error: null,
      started_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("job_key", jobKey)
    .eq("updated_at", existing.updated_at)
    .select("job_key")
    .maybeSingle();
  if (reclaimError) throw new Error(reclaimError.message);
  return Boolean(reclaimed);
}

async function finishJob(
  jobKey: string,
  status: "completed" | "failed",
  error?: unknown,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return;
  const now = new Date().toISOString();
  await supabase
    .from("bread_club_job_events")
    .update({
      status,
      completed_at: status === "completed" ? now : null,
      last_error:
        status === "failed"
          ? error instanceof Error
            ? error.message
            : String(error || "Job failed.")
          : null,
      updated_at: now,
    })
    .eq("job_key", jobKey);
}

function subscriptionDetails(subscription: Stripe.Subscription) {
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
    subscription.status === "past_due" || subscription.status === "unpaid"
      ? "past_due"
      : subscription.cancel_at_period_end
        ? "canceling"
        : subscription.status === "active" ||
            subscription.status === "trialing"
          ? "active"
          : "incomplete";

  return {
    planItemId: planItem?.id || null,
    deliveryItemId: deliveryItem?.id || null,
    periodEnd:
      periodEnd > 0 ? new Date(periodEnd * 1000).toISOString() : null,
    status,
  };
}

async function cleanupExpiredState(report: DailyReport, now: Date) {
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
      .in("id", expiredCreditIds);
    if (error) throw new Error(error.message);
  }
  report.creditsExpired = expiredCreditIds.length;

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
      .select("id, current_cycle_id")
      .eq("status", "pending_checkout")
      .lt("created_at", staleCheckoutBefore);
  if (staleMembershipError) throw new Error(staleMembershipError.message);
  for (const membership of staleMemberships || []) {
    if (!membership.current_cycle_id) continue;
    await markBreadClubCheckoutIncomplete(
      String(membership.id),
      String(membership.current_cycle_id),
    );
    report.staleCheckoutsReleased += 1;
  }

  const staleAddonBefore = new Date(
    now.getTime() - 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data: staleAddons, error: staleAddonError } = await supabase
    .from("bread_club_addon_checkouts")
    .select("id")
    .eq("status", "pending_payment")
    .lt("created_at", staleAddonBefore);
  if (staleAddonError) throw new Error(staleAddonError.message);
  for (const addon of staleAddons || []) {
    const { error } = await supabase.rpc(
      "release_bread_club_addon_inventory",
      { p_addon_checkout_id: addon.id },
    );
    if (error) throw new Error(error.message);
    report.staleAddonsReleased += 1;
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

async function reconcileCredits(report: DailyReport, now: Date) {
  const stripe = getStripe();
  const supabase = getSupabaseAdminClient();
  if (!stripe || !supabase) return;

  const { data, error } = await supabase
    .from("bread_club_rollover_credits")
    .select(
      "id, membership_id, delivery_fee_credit_cents, bread_club_memberships(stripe_customer_id, stripe_subscription_id)",
    )
    .eq("status", "available")
    .gt("expires_at", now.toISOString())
    .is("stripe_invoice_item_id", null);
  if (error) throw new Error(error.message);

  for (const credit of data || []) {
    const membership = Array.isArray(credit.bread_club_memberships)
      ? credit.bread_club_memberships[0]
      : credit.bread_club_memberships;
    if (!membership?.stripe_customer_id || !membership.stripe_subscription_id) {
      continue;
    }
    const jobKey = `credit-invoice-item:${credit.id}`;
    if (
      !(await claimJob(
        jobKey,
        "credit_reconciliation",
        String(credit.membership_id),
        { creditId: credit.id },
        now,
      ))
    ) {
      continue;
    }
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
      await finishJob(jobKey, "completed");
      report.creditsReconciled += 1;
    } catch (creditError) {
      await finishJob(jobKey, "failed", creditError);
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
      "id, status, stripe_customer_id, stripe_subscription_id, stripe_current_period_end, cancel_at_period_end",
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
        const details = subscriptionDetails(subscription);
        periodEnd = details.periodEnd;
        status = details.status;
        cancelAtPeriodEnd = subscription.cancel_at_period_end;
        const { error: updateError } = await supabase
          .from("bread_club_memberships")
          .update({
            status,
            cancel_at_period_end: cancelAtPeriodEnd,
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
    if (
      !(await claimJob(
        jobKey,
        "selection_reminder",
        member.id,
        { fulfillmentId: fulfillment.id },
        now,
      ))
    ) {
      continue;
    }
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
      });
      await finishJob(jobKey, "completed");
      report.remindersSent += 1;
    } catch (reminderError) {
      await finishJob(jobKey, "failed", reminderError);
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
  if (
    !(await claimJob(
      jobKey,
      "friday_summary",
      null,
      { deliveryLabel: admin.nextSunday.label },
      now,
    ))
  ) {
    return;
  }
  try {
    await sendBreadClubFridaySummary({
      to: recipient,
      deliveryLabel: admin.nextSunday.label,
      productionLines: admin.nextSunday.production.map(
        (item) => `${item.quantity} x ${item.productName}`,
      ),
      memberCount: admin.metrics.nextSundayStops,
    });
    await finishJob(jobKey, "completed");
    report.fridaySummarySent = true;
  } catch (summaryError) {
    await finishJob(jobKey, "failed", summaryError);
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
    staleCheckoutsReleased: 0,
    staleAddonsReleased: 0,
    fulfillmentsCompleted: 0,
    membershipsReconciled: 0,
    errors: [],
  };

  report.generatedMenuIds = await ensureRollingWeeklyMenus(now);
  await cleanupExpiredState(report, now);
  await reconcileFulfillments(report);
  await reconcileCredits(report, now);
  await reconcileMemberships(report, now);
  await sendReminders(report, now);
  await sendFridaySummary(report, now);
  return report;
}
