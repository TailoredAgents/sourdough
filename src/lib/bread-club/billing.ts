import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdminClient } from "@/lib/supabase";

const PROVIDER_REFUND_STATUSES = new Set([
  "pending",
  "requires_action",
  "succeeded",
  "failed",
  "canceled",
]);

type RefundProviderStatus =
  | "unknown"
  | "pending"
  | "requires_action"
  | "succeeded"
  | "failed"
  | "canceled";

type RefundAttemptClaim = {
  refund_state: "available" | "refund_pending" | "refunded";
  attempt_key: string | null;
  refund_id: string | null;
  provider_status: RefundProviderStatus | null;
  membership_id: string;
  stripe_invoice_id: string | null;
  stripe_invoice_item_id?: string | null;
  stripe_invoice_item_ids?: string[] | null;
  amount_cents: number;
};

export type BreadClubRefundOutcome = {
  kind: "rollover_credit" | "cycle";
  id: string;
  state: "refund_pending" | "refunded";
  attemptKey: string;
  refundId: string | null;
  refundStatus: RefundProviderStatus | null;
  amountCents: number;
};

export type BreadClubRefundReconciliation = {
  creditOutcomes: BreadClubRefundOutcome[];
  cycleOutcomes: BreadClubRefundOutcome[];
  errors: string[];
};

function paymentId(
  value: string | { id: string } | null | undefined,
) {
  return typeof value === "string" ? value : value?.id || null;
}

function firstRpcRow<T>(data: T | T[] | null): T | null {
  return Array.isArray(data) ? data[0] || null : data;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown Stripe error";
}

function refundProviderStatus(refund: Stripe.Refund) {
  const status = String(refund.status || "").toLowerCase();
  if (!PROVIDER_REFUND_STATUSES.has(status)) {
    throw new Error(`Stripe returned an unsupported refund status: ${status}.`);
  }
  return status as Exclude<RefundProviderStatus, "unknown">;
}

function refundFailureMessage(refund: Stripe.Refund) {
  const failureReason = refund.failure_reason
    ? String(refund.failure_reason)
    : null;
  if (failureReason) return `Stripe refund ${refund.status}: ${failureReason}`;
  if (refund.status === "requires_action") {
    return "Stripe requires action before this refund can complete.";
  }
  if (refund.status === "pending") {
    return "Stripe is still processing this refund.";
  }
  return null;
}

async function refundableInvoicePayment(
  stripe: Stripe,
  invoiceId: string,
) {
  const payments = await stripe.invoicePayments.list({
    invoice: invoiceId,
    status: "paid",
    limit: 10,
  });
  const payment = payments.data.find((item) => item.status === "paid");
  const paymentIntent = paymentId(payment?.payment.payment_intent);
  const charge = paymentId(payment?.payment.charge);
  if (!paymentIntent && !charge) {
    throw new Error("The invoice does not have a refundable Stripe payment.");
  }
  return { paymentIntent, charge };
}

async function removePendingInvoiceCredit(
  stripe: Stripe,
  invoiceItemId: string | null | undefined,
  creditId: string,
) {
  if (!invoiceItemId) return;
  try {
    await stripe.invoiceItems.del(invoiceItemId);
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String(error.code)
        : "";
    if (code !== "resource_missing") {
      throw new Error(
        `The pending Stripe delivery credit for ${creditId} could not be removed. No refund was issued.`,
        { cause: error },
      );
    }
  }
}

async function claimCreditRefund(creditId: string) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { data, error } = await supabase.rpc(
    "begin_bread_club_credit_refund_attempt",
    { p_credit_id: creditId },
  );
  if (error) throw new Error(error.message);
  const claim = firstRpcRow(data as RefundAttemptClaim | RefundAttemptClaim[]);
  if (!claim?.attempt_key) {
    if (claim?.refund_state === "refunded") return claim;
    throw new Error("The rollover-credit refund claim was not persisted.");
  }
  return claim;
}

async function recordCreditRefund(
  creditId: string,
  claim: RefundAttemptClaim,
  refund: Stripe.Refund,
): Promise<BreadClubRefundOutcome> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const providerStatus = refundProviderStatus(refund);
  const { data, error } = await supabase.rpc(
    "record_bread_club_credit_refund",
    {
      p_credit_id: creditId,
      p_attempt_key: claim.attempt_key,
      p_stripe_refund_id: refund.id,
      p_stripe_refund_status: providerStatus,
      p_last_error: refundFailureMessage(refund),
    },
  );
  if (error) throw new Error(error.message);
  return {
    kind: "rollover_credit",
    id: creditId,
    state: String(data) === "refunded" ? "refunded" : "refund_pending",
    attemptKey: claim.attempt_key!,
    refundId: refund.id,
    refundStatus: providerStatus,
    amountCents: Number(claim.amount_cents),
  };
}

async function recordCreditRefundError(
  creditId: string,
  claim: RefundAttemptClaim,
  error: unknown,
) {
  if (!claim.attempt_key) return;
  const supabase = getSupabaseAdminClient();
  if (!supabase) return;
  const { error: recordError } = await supabase.rpc(
    "record_bread_club_credit_refund_error",
    {
      p_credit_id: creditId,
      p_attempt_key: claim.attempt_key,
      p_last_error: errorMessage(error),
    },
  );
  if (recordError) {
    console.error("[bread-club] could not persist credit refund error", {
      creditId,
      error: recordError.message,
    });
  }
}

export async function requestBreadClubRolloverCreditRefund(
  creditId: string,
): Promise<BreadClubRefundOutcome> {
  const stripe = getStripe();
  if (!stripe) throw new Error("Stripe is not configured.");
  const claim = await claimCreditRefund(creditId);

  if (claim.refund_state === "refunded") {
    return {
      kind: "rollover_credit",
      id: creditId,
      state: "refunded",
      attemptKey: claim.attempt_key || "legacy-refund",
      refundId: claim.refund_id,
      refundStatus: claim.provider_status,
      amountCents: Number(claim.amount_cents),
    };
  }
  if (!claim.attempt_key || !claim.stripe_invoice_id) {
    throw new Error("The rollover credit does not have a refundable invoice.");
  }

  try {
    if (claim.refund_id) {
      const refund = await stripe.refunds.retrieve(claim.refund_id);
      return recordCreditRefund(creditId, claim, refund);
    }

    await removePendingInvoiceCredit(
      stripe,
      claim.stripe_invoice_item_id,
      creditId,
    );
    const payment = await refundableInvoicePayment(
      stripe,
      claim.stripe_invoice_id,
    );
    const refund = await stripe.refunds.create(
      {
        ...(payment.paymentIntent
          ? { payment_intent: payment.paymentIntent }
          : { charge: payment.charge! }),
        amount: Number(claim.amount_cents),
        reason: "requested_by_customer",
        metadata: {
          bread_club_membership_id: claim.membership_id,
          bread_club_rollover_credit_id: creditId,
          bread_club_refund_attempt_key: claim.attempt_key,
        },
      },
      { idempotencyKey: claim.attempt_key },
    );
    return recordCreditRefund(creditId, claim, refund);
  } catch (error) {
    await recordCreditRefundError(creditId, claim, error);
    throw error;
  }
}

export async function reconcileBreadClubRolloverCreditRefund(
  creditId: string,
) {
  return requestBreadClubRolloverCreditRefund(creditId);
}

async function claimCycleRefund(cycleId: string) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { data, error } = await supabase.rpc(
    "begin_bread_club_cycle_refund_attempt",
    { p_cycle_id: cycleId },
  );
  if (error) throw new Error(error.message);
  const claim = firstRpcRow(data as RefundAttemptClaim | RefundAttemptClaim[]);
  if (!claim?.attempt_key) {
    if (claim?.refund_state === "refunded") return claim;
    throw new Error("The Bread Club cycle refund claim was not persisted.");
  }
  return claim;
}

async function recordCycleRefund(
  cycleId: string,
  claim: RefundAttemptClaim,
  refund: Stripe.Refund,
  adminNote: string,
): Promise<BreadClubRefundOutcome> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const providerStatus = refundProviderStatus(refund);
  const { data, error } = await supabase.rpc(
    "record_bread_club_cycle_refund",
    {
      p_cycle_id: cycleId,
      p_attempt_key: claim.attempt_key,
      p_stripe_refund_id: refund.id,
      p_stripe_refund_status: providerStatus,
      p_admin_note: adminNote || "Refund requested by owner",
      p_last_error: refundFailureMessage(refund),
    },
  );
  if (error) throw new Error(error.message);
  return {
    kind: "cycle",
    id: cycleId,
    state: String(data) === "refunded" ? "refunded" : "refund_pending",
    attemptKey: claim.attempt_key!,
    refundId: refund.id,
    refundStatus: providerStatus,
    amountCents: Number(claim.amount_cents),
  };
}

async function recordCycleRefundError(
  cycleId: string,
  claim: RefundAttemptClaim,
  error: unknown,
) {
  if (!claim.attempt_key) return;
  const supabase = getSupabaseAdminClient();
  if (!supabase) return;
  const { error: recordError } = await supabase.rpc(
    "record_bread_club_cycle_refund_error",
    {
      p_cycle_id: cycleId,
      p_attempt_key: claim.attempt_key,
      p_last_error: errorMessage(error),
    },
  );
  if (recordError) {
    console.error("[bread-club] could not persist cycle refund error", {
      cycleId,
      error: recordError.message,
    });
  }
}

export async function requestBreadClubCycleRefund(
  cycleId: string,
  adminNote = "Refund requested by owner",
): Promise<BreadClubRefundOutcome> {
  const stripe = getStripe();
  if (!stripe) throw new Error("Stripe is not configured.");
  const claim = await claimCycleRefund(cycleId);

  if (claim.refund_state === "refunded") {
    return {
      kind: "cycle",
      id: cycleId,
      state: "refunded",
      attemptKey: claim.attempt_key || "legacy-refund",
      refundId: claim.refund_id,
      refundStatus: claim.provider_status,
      amountCents: Number(claim.amount_cents),
    };
  }
  if (!claim.attempt_key || !claim.stripe_invoice_id) {
    throw new Error("The Bread Club cycle does not have a refundable invoice.");
  }

  try {
    if (claim.refund_id) {
      const refund = await stripe.refunds.retrieve(claim.refund_id);
      return recordCycleRefund(cycleId, claim, refund, adminNote);
    }

    for (const invoiceItemId of claim.stripe_invoice_item_ids || []) {
      await removePendingInvoiceCredit(
        stripe,
        String(invoiceItemId),
        `cycle ${cycleId}`,
      );
    }

    const payment = await refundableInvoicePayment(
      stripe,
      claim.stripe_invoice_id,
    );
    const refund = await stripe.refunds.create(
      {
        ...(payment.paymentIntent
          ? { payment_intent: payment.paymentIntent }
          : { charge: payment.charge! }),
        amount: Number(claim.amount_cents),
        reason: "requested_by_customer",
        metadata: {
          bread_club_membership_id: claim.membership_id,
          bread_club_cycle_id: cycleId,
          bread_club_refund_attempt_key: claim.attempt_key,
        },
      },
      { idempotencyKey: claim.attempt_key },
    );
    return recordCycleRefund(cycleId, claim, refund, adminNote);
  } catch (error) {
    await recordCycleRefundError(cycleId, claim, error);
    throw error;
  }
}

export async function reconcileBreadClubCycleRefund(
  cycleId: string,
  adminNote = "Refund reconciled automatically",
) {
  return requestBreadClubCycleRefund(cycleId, adminNote);
}

export async function reconcileBreadClubPendingRefunds(
  membershipId?: string,
): Promise<BreadClubRefundReconciliation> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  let creditQuery = supabase
    .from("bread_club_rollover_credits")
    .select("id")
    .eq("status", "refund_pending")
    .order("updated_at", { ascending: true })
    .limit(100);
  let cycleQuery = supabase
    .from("bread_club_cycles")
    .select("id")
    .eq("status", "refund_pending")
    .order("updated_at", { ascending: true })
    .limit(100);
  if (membershipId) {
    creditQuery = creditQuery.eq("membership_id", membershipId);
    cycleQuery = cycleQuery.eq("membership_id", membershipId);
  }

  const [creditResult, cycleResult] = await Promise.all([
    creditQuery,
    cycleQuery,
  ]);
  if (creditResult.error) throw new Error(creditResult.error.message);
  if (cycleResult.error) throw new Error(cycleResult.error.message);

  const reconciliation: BreadClubRefundReconciliation = {
    creditOutcomes: [],
    cycleOutcomes: [],
    errors: [],
  };
  for (const credit of creditResult.data || []) {
    try {
      reconciliation.creditOutcomes.push(
        await reconcileBreadClubRolloverCreditRefund(String(credit.id)),
      );
    } catch (error) {
      reconciliation.errors.push(
        `Rollover credit ${credit.id}: ${errorMessage(error)}`,
      );
    }
  }
  for (const cycle of cycleResult.data || []) {
    try {
      reconciliation.cycleOutcomes.push(
        await reconcileBreadClubCycleRefund(String(cycle.id)),
      );
    } catch (error) {
      reconciliation.errors.push(
        `Cycle ${cycle.id}: ${errorMessage(error)}`,
      );
    }
  }
  return reconciliation;
}

export async function markInvoiceDeliveryCreditsApplied(
  membershipId: string,
  invoice: Stripe.Invoice,
) {
  const creditIds = invoice.lines.data
    .map((line) => line.metadata?.bread_club_rollover_credit_id || null)
    .filter((id): id is string => Boolean(id));
  if (!creditIds.length) return;
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { error } = await supabase
    .from("bread_club_rollover_credits")
    .update({
      delivery_credit_applied_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("membership_id", membershipId)
    .in("id", creditIds)
    .is("delivery_credit_applied_at", null)
    .eq("status", "available");
  if (error) throw new Error(error.message);
}

export async function refundBreadClubUnusedCredits(
  membershipId: string,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data: membership, error: membershipError } = await supabase
    .from("bread_club_memberships")
    .select("status, canceled_at")
    .eq("id", membershipId)
    .maybeSingle();
  if (membershipError) throw new Error(membershipError.message);
  if (!membership) throw new Error("Bread Club membership was not found.");

  const eligibilityCutoff =
    membership.status === "canceled" && membership.canceled_at
      ? String(membership.canceled_at)
      : new Date().toISOString();

  const { data: credits, error } = await supabase
    .from("bread_club_rollover_credits")
    .select("id")
    .eq("membership_id", membershipId)
    .in("status", ["available", "expired", "refund_pending"])
    .gt("expires_at", eligibilityCutoff)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const results: BreadClubRefundOutcome[] = [];
  for (const credit of credits || []) {
    results.push(
      await requestBreadClubRolloverCreditRefund(String(credit.id)),
    );
  }
  return results;
}
