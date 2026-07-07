import { NextResponse } from "next/server";
import { sendOrderConfirmation } from "@/lib/email";
import {
  cancelExpiredCheckoutSession,
  markCheckoutSessionPaid,
} from "@/lib/order-records";
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
    const paidOrder = await markCheckoutSessionPaid(session.id);

    if (paidOrder?.customerEmail) {
      await sendOrderConfirmation({
        to: paidOrder.customerEmail,
        customerName: paidOrder.customerName,
        orderSummary: paidOrder.orderSummary,
        deliveryWindow: paidOrder.deliveryWindow,
      });
    }

    console.log("[stripe:webhook] paid order", {
      sessionId: session.id,
      orderId: paidOrder?.orderId || session.metadata?.order_id,
      customerEmail: paidOrder?.customerEmail || session.customer_email,
      deliveryWindow: paidOrder?.deliveryWindow || session.metadata?.delivery_window,
    });
  }

  if (event.type === "checkout.session.expired") {
    const orderId = await cancelExpiredCheckoutSession(event.data.object.id);
    console.log("[stripe:webhook] checkout expired", {
      sessionId: event.data.object.id,
      orderId,
    });
  }

  return NextResponse.json({ received: true });
}
