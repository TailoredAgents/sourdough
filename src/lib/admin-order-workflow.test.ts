import { describe, expect, it } from "vitest";
import { getAdminOrderStatusActions } from "./admin-order-workflow";

describe("admin order workflow actions", () => {
  it("surfaces the next owner action for active paid orders", () => {
    expect(getAdminOrderStatusActions("paid")).toEqual([
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
    ]);
    expect(getAdminOrderStatusActions("baking")[0]).toEqual({
      label: "Out for delivery",
      status: "out_for_delivery",
      variant: "primary",
    });
    expect(getAdminOrderStatusActions("out_for_delivery")[0]).toEqual({
      label: "Mark delivered",
      status: "delivered",
      variant: "primary",
    });
  });

  it("keeps recovery actions available for completed or canceled orders", () => {
    expect(getAdminOrderStatusActions("delivered")).toEqual([
      {
        label: "Reopen as out for delivery",
        status: "out_for_delivery",
        variant: "secondary",
      },
    ]);
    expect(getAdminOrderStatusActions("canceled")).toEqual([
      {
        label: "Restore to paid",
        status: "paid",
        variant: "secondary",
      },
    ]);
  });
});
