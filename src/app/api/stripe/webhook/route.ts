import { NextResponse } from "next/server";
import {
  sendCustomerOrderConfirmation,
  sendOwnerNewOrderNotification,
} from "@/lib/email";
import {
  cancelExpiredCheckoutSession,
  markCheckoutSessionPaid,
} from "@/lib/order-records";
import { sendOwnerAlert } from "@/lib/owner-alerts";
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
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const paidOrder = await markCheckoutSessionPaid(session.id);

      if (paidOrder?.customerEmail) {
        await sendCustomerOrderConfirmation({
          to: paidOrder.customerEmail,
          customerName: paidOrder.customerName,
          orderSummary: paidOrder.orderSummary,
          deliveryWindow: paidOrder.deliveryWindow,
          orderId: paidOrder.orderId,
        });
      }

      if (paidOrder && process.env.BAKERY_EMAIL) {
        await sendOwnerNewOrderNotification({
          to: process.env.BAKERY_EMAIL,
          customerName: paidOrder.customerName,
          customerEmail: paidOrder.customerEmail,
          customerPhone: paidOrder.customerPhone,
          orderSummary: paidOrder.orderSummary,
          deliveryWindow: paidOrder.deliveryWindow,
          orderId: paidOrder.orderId,
          address: paidOrder.deliveryAddress,
          notes: paidOrder.notes || "",
        });
      }
      if (paidOrder) {
        await sendOwnerAlert({
          type: "order",
          customerName: paidOrder.customerName,
          orderSummary: paidOrder.orderSummary,
          notes: paidOrder.notes || null,
          orderId: paidOrder.orderId,
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
