import { NextResponse } from "next/server";
import { sendOrderConfirmation } from "@/lib/email";
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

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    if (session.customer_email) {
      await sendOrderConfirmation({
        to: session.customer_email,
        customerName: String(session.metadata?.customer_name || "there"),
        orderSummary: String(session.metadata?.cart || "Order paid in Stripe Checkout"),
        deliveryWindow: String(session.metadata?.delivery_window || "Selected window"),
      });
    }

    console.log("[stripe:webhook] paid order", {
      sessionId: session.id,
      customerEmail: session.customer_email,
      deliveryWindow: session.metadata?.delivery_window,
    });
  }

  if (event.type === "checkout.session.expired") {
    console.log("[stripe:webhook] checkout expired", event.data.object.id);
  }

  return NextResponse.json({ received: true });
}
