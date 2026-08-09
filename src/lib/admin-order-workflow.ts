import type { AdminOrder, OrderStatus } from "./types";

export type AdminOrderStatusAction = {
  label: string;
  status: OrderStatus;
  variant?: "primary" | "secondary" | "ghost";
};

export function getAdminOrderStatusActions(
  status: OrderStatus,
  source: AdminOrder["source"] = "storefront",
): AdminOrderStatusAction[] {
  switch (status) {
    case "pending_payment":
      return source === "storefront"
        ? [
            {
              label: "Cancel unpaid checkout",
              status: "canceled",
              variant: "ghost",
            },
          ]
        : [];
    case "pending_approval_payment":
      return source === "storefront"
        ? [
            {
              label: "Cancel unpaid request",
              status: "canceled",
              variant: "ghost",
            },
          ]
        : [];
    case "pending_approval":
      return [];
    case "paid":
      return [
        {
          label: "Complete order",
          status: "delivered",
          variant: "primary",
        },
        {
          label: "Start baking",
          status: "baking",
          variant: "secondary",
        },
      ];
    case "baking":
      return [
        {
          label: "Complete order",
          status: "delivered",
          variant: "primary",
        },
        {
          label: "Out for delivery",
          status: "out_for_delivery",
          variant: "secondary",
        },
      ];
    case "out_for_delivery":
      return [
        {
          label: "Complete order",
          status: "delivered",
          variant: "primary",
        },
        {
          label: "Back to baking",
          status: "baking",
          variant: "secondary",
        },
      ];
    case "delivered":
      return [
        {
          label: "Reopen as out for delivery",
          status: "out_for_delivery",
          variant: "secondary",
        },
      ];
    case "canceled":
      return [];
    case "draft":
    default:
      return [];
  }
}

export function isAdminOrderTransitionAllowed(
  source: AdminOrder["source"],
  previousStatus: OrderStatus,
  nextStatus: OrderStatus,
) {
  return getAdminOrderStatusActions(previousStatus, source).some(
    (action) => action.status === nextStatus,
  );
}
