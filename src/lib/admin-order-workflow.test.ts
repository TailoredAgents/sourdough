import { describe, expect, it } from "vitest";
import { getAdminOrderStatusActions } from "./admin-order-workflow";
import { getAdminOrderInventoryAdjustment } from "./order-admin";

describe("admin order workflow actions", () => {
  it("surfaces the next owner action for active paid orders", () => {
    expect(getAdminOrderStatusActions("paid")).toEqual([
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
        label: "Restore & reserve inventory",
        status: "paid",
        variant: "secondary",
      },
    ]);
  });

  it("identifies when admin status changes must adjust inventory reservations", () => {
    expect(getAdminOrderInventoryAdjustment("pending_payment", "canceled")).toBe(
      "release",
    );
    expect(getAdminOrderInventoryAdjustment("paid", "canceled")).toBe("release");
    expect(getAdminOrderInventoryAdjustment("baking", "canceled")).toBe("release");
    expect(getAdminOrderInventoryAdjustment("out_for_delivery", "canceled")).toBe(
      "release",
    );
    expect(getAdminOrderInventoryAdjustment("canceled", "paid")).toBe("reserve");
    expect(getAdminOrderInventoryAdjustment("delivered", "canceled")).toBeNull();
    expect(getAdminOrderInventoryAdjustment("paid", "baking")).toBeNull();
    expect(getAdminOrderInventoryAdjustment("paid", "paid")).toBeNull();
  });
});
