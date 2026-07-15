import type { OrderStatus } from "./types";

export type AdminOrderStatusAction = {
  label: string;
  status: OrderStatus;
  variant?: "primary" | "secondary" | "ghost";
};

export function getAdminOrderStatusActions(
  status: OrderStatus,
): AdminOrderStatusAction[] {
  switch (status) {
    case "pending_payment":
      return [
        {
          label: "Mark paid",
          status: "paid",
          variant: "secondary",
        },
        {
          label: "Cancel order",
          status: "canceled",
          variant: "ghost",
        },
      ];
    case "paid":
      return [
        {
          label: "Start baking",
          status: "baking",
          variant: "primary",
        },
        {
          label: "Cancel order",
          status: "canceled",
          variant: "ghost",
        },
      ];
    case "baking":
      return [
        {
          label: "Out for delivery",
          status: "out_for_delivery",
          variant: "primary",
        },
        {
          label: "Cancel order",
          status: "canceled",
          variant: "ghost",
        },
      ];
    case "out_for_delivery":
      return [
        {
          label: "Mark delivered",
          status: "delivered",
          variant: "primary",
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
      return [
        {
          label: "Restore to paid",
          status: "paid",
          variant: "secondary",
        },
      ];
    case "draft":
    default:
      return [];
  }
}
