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
          label: "Mark paid manually",
          status: "paid",
          variant: "secondary",
        },
        {
          label: "Cancel & release inventory",
          status: "canceled",
          variant: "ghost",
        },
      ];
    case "pending_approval_payment":
      return [
        {
          label: "Cancel unpaid request",
          status: "canceled",
          variant: "ghost",
        },
      ];
    case "pending_approval":
      return [];
    case "paid":
      return [
        {
          label: "Start baking",
          status: "baking",
          variant: "primary",
        },
        {
          label: "Cancel & release inventory",
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
          label: "Cancel & release inventory",
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
          label: "Restore & reserve inventory",
          status: "paid",
          variant: "secondary",
        },
      ];
    case "draft":
    default:
      return [];
  }
}
