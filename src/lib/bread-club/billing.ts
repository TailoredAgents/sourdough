import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdminClient } from "@/lib/supabase";

function paymentId(
  value: string | { id: string } | null | undefined,
) {
  return typeof value === "string" ? value : value?.id || null;
}

export async function markInvoiceDeliveryCreditsApplied(
  membershipId: string,
  invoice: Stripe.Invoice,
) {
  const creditIds = invoice.lines.data
    .map(
      (line) =>
        line.metadata?.bread_club_rollover_credit_id || null,
    )
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
    .is("delivery_credit_applied_at", null);
  if (error) throw new Error(error.message);
}

export async function refundBreadClubUnusedCredits(
  membershipId: string,
) {
  const stripe = getStripe();
  const supabase = getSupabaseAdminClient();
  if (!stripe) throw new Error("Stripe is not configured.");
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data: credits, error: creditsError } = await supabase
    .from("bread_club_rollover_credits")
    .select(
      "id, source_fulfillment_id, delivery_fee_credit_cents, stripe_invoice_item_id, delivery_credit_applied_at",
    )
    .eq("membership_id", membershipId)
    .eq("status", "available")
    .gt("expires_at", new Date().toISOString());
  if (creditsError) throw new Error(creditsError.message);

  const results = [];
  for (const credit of credits || []) {
    const { data: fulfillment, error: fulfillmentError } = await supabase
      .from("bread_club_fulfillments")
      .select("cycle_id")
      .eq("id", credit.source_fulfillment_id)
      .maybeSingle();
    if (fulfillmentError) throw new Error(fulfillmentError.message);
    if (!fulfillment?.cycle_id) continue;

    const { data: cycle, error: cycleError } = await supabase
      .from("bread_club_cycles")
      .select("plan_price_cents, stripe_invoice_id")
      .eq("id", fulfillment.cycle_id)
      .maybeSingle();
    if (cycleError) throw new Error(cycleError.message);
    if (!cycle?.stripe_invoice_id) continue;

    const deliveryRefund = credit.delivery_credit_applied_at
      ? 0
      : Number(credit.delivery_fee_credit_cents);
    const amount = Math.floor(Number(cycle.plan_price_cents) / 4) +
      deliveryRefund;
    if (amount <= 0) continue;

    if (
      credit.stripe_invoice_item_id &&
      !credit.delivery_credit_applied_at
    ) {
      try {
        await stripe.invoiceItems.del(
          String(credit.stripe_invoice_item_id),
        );
      } catch (error) {
        const code =
          typeof error === "object" && error && "code" in error
            ? String(error.code)
            : "";
        if (code !== "resource_missing") {
          throw new Error(
            `The pending Stripe delivery credit for ${credit.id} could not be removed. No refund was issued.`,
            { cause: error },
          );
        }
      }
    }

    const payments = await stripe.invoicePayments.list({
      invoice: String(cycle.stripe_invoice_id),
      status: "paid",
      limit: 10,
    });
    const payment = payments.data.find(
      (item) => item.status === "paid",
    );
    const paymentIntent = paymentId(payment?.payment.payment_intent);
    const charge = paymentId(payment?.payment.charge);
    if (!paymentIntent && !charge) {
      throw new Error(
        `No refundable Stripe payment was found for credit ${credit.id}.`,
      );
    }

    const refund = await stripe.refunds.create(
      {
        ...(paymentIntent
          ? { payment_intent: paymentIntent }
          : { charge: charge! }),
        amount,
        reason: "requested_by_customer",
        metadata: {
          bread_club_membership_id: membershipId,
          bread_club_rollover_credit_id: String(credit.id),
        },
      },
      {
        idempotencyKey: `bread-club-credit-refund-${credit.id}`,
      },
    );
    const { error: updateError } = await supabase
      .from("bread_club_rollover_credits")
      .update({
        status: "refunded",
        refunded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", credit.id)
      .eq("status", "available");
    if (updateError) throw new Error(updateError.message);
    results.push({
      creditId: String(credit.id),
      refundId: refund.id,
      amount,
    });
  }

  return results;
}
