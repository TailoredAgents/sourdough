import { completeStorefrontCheckoutSession } from "./order-payment";
import { cancelExpiredCheckoutSession } from "./order-records";
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
  errors: string[];
};

export async function reconcileStorefrontCheckoutSessions(
  now = new Date(),
): Promise<StorefrontCheckoutReconciliationReport> {
  const stripe = getStripe();
  const supabase = getSupabaseAdminClient();
  if (!stripe) throw new Error("STRIPE_SECRET_KEY is not configured.");
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const report: StorefrontCheckoutReconciliationReport = {
    checked: 0,
    paidOrdersRecovered: 0,
    expiredOrdersReleased: 0,
    errors: [],
  };
  const createdAfter = new Date(
    now.getTime() - 14 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await supabase
    .from("orders")
    .select("id, stripe_checkout_session_id")
    .in("status", ["pending_payment", "pending_approval_payment"])
    .not("stripe_checkout_session_id", "is", null)
    .gte("created_at", createdAfter)
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
        const releasedOrderId = await cancelExpiredCheckoutSession(session.id);
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
