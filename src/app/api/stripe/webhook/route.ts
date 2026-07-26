import { NextResponse } from "next/server";
import { cancelExpiredCheckoutSession } from "@/lib/order-records";
import { handleBreadClubStripeEvent } from "@/lib/bread-club/webhook";
import { completeStorefrontCheckoutSession } from "@/lib/order-payment";
import { getStripe } from "@/lib/stripe";

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

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      await completeStorefrontCheckoutSession(session);
    }

    if (event.type === "checkout.session.expired") {
      const orderId = await cancelExpiredCheckoutSession(event.data.object.id);
      console.log("[stripe:webhook] checkout expired", {
        sessionId: event.data.object.id,
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
