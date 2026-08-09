import { NextResponse } from "next/server";
import { cancelExpiredCheckoutSession } from "@/lib/order-records";
import { handleBreadClubStripeEvent } from "@/lib/bread-club/webhook";
import { completeStorefrontCheckoutSession } from "@/lib/order-payment";
import { getStripe } from "@/lib/stripe";

function getStorefrontOrderId(value: unknown) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
    ? value
    : null;
}

export async function POST(request: Request) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !webhookSecret) {
    return NextResponse.json(
      { error: "Stripe webhook is not configured." },
      { status: 501 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });
  }

  const body = await request.text();
  let event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid webhook.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const breadClubHandled = await handleBreadClubStripeEvent(event);
    if (breadClubHandled) {
      return NextResponse.json({ received: true });
    }

    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const session = event.data.object;
      await completeStorefrontCheckoutSession(session);
    }

    if (
      event.type === "checkout.session.expired" ||
      event.type === "checkout.session.async_payment_failed"
    ) {
      const checkoutSession = event.data.object;
      const recoveryOrderId = getStorefrontOrderId(
        checkoutSession.metadata?.order_id,
      );
      const orderId = recoveryOrderId
        ? await cancelExpiredCheckoutSession(
            checkoutSession.id,
            recoveryOrderId,
          )
        : await cancelExpiredCheckoutSession(checkoutSession.id);
      console.log("[stripe:webhook] checkout closed without payment", {
        sessionId: event.data.object.id,
        eventType: event.type,
        orderId,
      });
    }
  } catch (error) {
    console.error("[stripe:webhook] handling failed", {
      eventId: event.id,
      eventType: event.type,
      error,
    });
    return NextResponse.json({ error: "Webhook handling failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
