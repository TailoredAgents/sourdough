import { completeStorefrontCheckoutSession } from "./order-payment";
import {
  cancelExpiredCheckoutSession,
  cleanupAbandonedStorefrontCheckouts,
} from "./order-records";
import { getStripe } from "./stripe";
import { getSupabaseAdminClient } from "./supabase";

type PendingCheckoutRow = {
  id: string;
  stripe_checkout_session_id: string;
};

export type StorefrontCheckoutReconciliationReport = {
  checked: number;
  paidOrdersRecovered: number;
  expiredOrdersReleased: number;
  abandonedOrdersCanceled: number;
  errors: string[];
};

export async function reconcileStorefrontCheckoutSessions(): Promise<StorefrontCheckoutReconciliationReport> {
  const stripe = getStripe();
  const supabase = getSupabaseAdminClient();
  if (!stripe) throw new Error("STRIPE_SECRET_KEY is not configured.");
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const report: StorefrontCheckoutReconciliationReport = {
    checked: 0,
    paidOrdersRecovered: 0,
    expiredOrdersReleased: 0,
    abandonedOrdersCanceled: 0,
    errors: [],
  };
  report.abandonedOrdersCanceled =
    await cleanupAbandonedStorefrontCheckouts();
  const { data, error } = await supabase
    .from("orders")
    .select("id, stripe_checkout_session_id")
    .in("status", ["pending_payment", "pending_approval_payment"])
    .not("stripe_checkout_session_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) throw new Error(error.message);

  for (const order of (data || []) as PendingCheckoutRow[]) {
    report.checked += 1;
    try {
      const session = await stripe.checkout.sessions.retrieve(
        order.stripe_checkout_session_id,
      );

      if (
        session.status === "complete" &&
        session.payment_status === "paid"
      ) {
        const paidOrder = await completeStorefrontCheckoutSession(session);
        if (paidOrder) report.paidOrdersRecovered += 1;
        continue;
      }

      if (session.status === "expired") {
        const recoveryOrderId = session.metadata?.order_id;
        const releasedOrderId =
          typeof recoveryOrderId === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            recoveryOrderId,
          )
            ? await cancelExpiredCheckoutSession(session.id, recoveryOrderId)
            : await cancelExpiredCheckoutSession(session.id);
        if (releasedOrderId) report.expiredOrdersReleased += 1;
      }
    } catch (reconciliationError) {
      const message =
        reconciliationError instanceof Error
          ? reconciliationError.message
          : "Unknown reconciliation error";
      report.errors.push(`Order ${order.id}: ${message}`);
    }
  }

  return report;
}
