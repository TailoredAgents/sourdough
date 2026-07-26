import type Stripe from "stripe";
import {
  hasSentEmailEvent,
  sendCustomerApprovalRequestReceived,
  sendCustomerOrderConfirmation,
  sendOwnerApprovalRequestNotification,
  sendOwnerNewOrderNotification,
  type EmailTemplate,
} from "./email";
import {
  getPaidCheckoutOrderSummaryBySessionId,
  markCheckoutSessionPaid,
} from "./order-records";
import { sendOwnerAlert } from "./owner-alerts";

async function sendOrderEmailOnce({
  template,
  to,
  orderId,
  send,
}: {
  template: EmailTemplate;
  to: string;
  orderId: string;
  send: () => Promise<unknown>;
}) {
  if (
    !to ||
    (await hasSentEmailEvent({
      template,
      to,
      orderId,
    }))
  ) {
    return;
  }
  await send();
}

export async function completeStorefrontCheckoutSession(
  session: Stripe.Checkout.Session,
) {
  const paidOrder =
    (await markCheckoutSessionPaid(session.id, {
      taxCents: session.total_details?.amount_tax,
      totalCents: session.amount_total,
    })) || (await getPaidCheckoutOrderSummaryBySessionId(session.id));

  if (!paidOrder) return null;

  if (paidOrder.customerEmail) {
    if (paidOrder.status === "pending_approval") {
      await sendOrderEmailOnce({
        template: "customer_approval_request_received",
        to: paidOrder.customerEmail,
        orderId: paidOrder.orderId,
        send: () =>
          sendCustomerApprovalRequestReceived({
            to: paidOrder.customerEmail,
            customerName: paidOrder.customerName,
            orderSummary: paidOrder.orderSummary,
            deliveryWindow: paidOrder.deliveryWindow,
            orderId: paidOrder.orderId,
          }),
      });
    } else {
      await sendOrderEmailOnce({
        template: "customer_order_confirmation",
        to: paidOrder.customerEmail,
        orderId: paidOrder.orderId,
        send: () =>
          sendCustomerOrderConfirmation({
            to: paidOrder.customerEmail,
            customerName: paidOrder.customerName,
            orderSummary: paidOrder.orderSummary,
            deliveryWindow: paidOrder.deliveryWindow,
            orderId: paidOrder.orderId,
          }),
      });
    }
  }

  const bakeryEmail = process.env.BAKERY_EMAIL;
  if (bakeryEmail) {
    const ownerNotification = {
      to: bakeryEmail,
      customerName: paidOrder.customerName,
      customerEmail: paidOrder.customerEmail,
      customerPhone: paidOrder.customerPhone,
      orderSummary: paidOrder.orderSummary,
      deliveryWindow: paidOrder.deliveryWindow,
      orderId: paidOrder.orderId,
      address: paidOrder.deliveryAddress,
      notes: paidOrder.notes || "",
    };

    if (paidOrder.status === "pending_approval") {
      await sendOrderEmailOnce({
        template: "owner_approval_request",
        to: bakeryEmail,
        orderId: paidOrder.orderId,
        send: () =>
          sendOwnerApprovalRequestNotification(ownerNotification),
      });
    } else {
      await sendOrderEmailOnce({
        template: "owner_new_order",
        to: bakeryEmail,
        orderId: paidOrder.orderId,
        send: () => sendOwnerNewOrderNotification(ownerNotification),
      });
    }
  }

  await sendOwnerAlert({
    type: "order",
    customerName: paidOrder.customerName,
    orderSummary: paidOrder.orderSummary,
    notes:
      paidOrder.status === "pending_approval"
        ? `Paid same-week approval request. ${paidOrder.notes || ""}`.trim()
        : paidOrder.notes || null,
    orderId: paidOrder.orderId,
    throwOnFailure: true,
  });

  console.log("[stripe:webhook] paid order", {
    sessionId: session.id,
    orderId: paidOrder.orderId,
    customerEmail: paidOrder.customerEmail || session.customer_email,
    deliveryWindow: paidOrder.deliveryWindow,
  });

  return paidOrder;
}
