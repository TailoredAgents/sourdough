import type { OrderStatus } from "./types";

export const customerOrderStatusLabels: Record<OrderStatus, string> = {
  draft: "Order started",
  pending_payment: "Payment being confirmed",
  pending_approval_payment: "Payment being confirmed",
  pending_approval: "Awaiting bakery approval",
  paid: "Payment confirmed",
  baking: "Baking soon",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  canceled: "Canceled",
};

export const customerOrderStatusMessages: Record<OrderStatus, string> = {
  draft: "Your order has not been submitted yet.",
  pending_payment:
    "Stripe is confirming payment. Your order details are saved, and we will email you once payment is confirmed.",
  pending_approval_payment:
    "Stripe is confirming payment. Your approval request is saved, and we will email you once payment is confirmed.",
  pending_approval:
    "Payment is confirmed. The bakery is reviewing your same-week request and will email you after it is accepted, moved, or refunded.",
  paid: "Payment is confirmed. Watch your email for order and delivery updates.",
  baking: "Your order is in the bake queue.",
  out_for_delivery: "Your order is on the way during the selected delivery window.",
  delivered: "Your order has been marked delivered.",
  canceled: "This order has been canceled.",
};

export function getCustomerOrderStatusLabel(status: OrderStatus) {
  return customerOrderStatusLabels[status] ?? "Order update";
}

export function getCustomerOrderStatusMessage(status: OrderStatus) {
  return customerOrderStatusMessages[status] ?? "Watch your email for updates.";
}
