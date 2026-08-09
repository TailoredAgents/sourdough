import { describe, expect, it } from "vitest";
import { getAdminOrderStatusActions } from "./admin-order-workflow";
import { getAdminOrderInventoryAdjustment } from "./order-admin";

describe("admin order workflow actions", () => {
  it("lets the owner complete any active paid order in one step", () => {
    expect(getAdminOrderStatusActions("paid")).toEqual([
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
    ]);
    expect(getAdminOrderStatusActions("baking")[0]).toEqual({
      label: "Complete order",
      status: "delivered",
      variant: "primary",
    });
    expect(getAdminOrderStatusActions("baking")[1]).toEqual({
      label: "Out for delivery",
      status: "out_for_delivery",
      variant: "secondary",
    });
    expect(getAdminOrderStatusActions("out_for_delivery")[0]).toEqual({
      label: "Complete order",
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
    expect(getAdminOrderStatusActions("canceled")).toEqual([]);
  });

  it("keeps paid approval requests on the dedicated approval workflow", () => {
    expect(getAdminOrderStatusActions("pending_approval")).toEqual([]);
    expect(getAdminOrderStatusActions("pending_approval_payment")).toEqual([
      {
        label: "Cancel unpaid request",
        status: "canceled",
        variant: "ghost",
      },
    ]);
  });

  it("does not expose generic cancel or restore controls for Bread Club orders", () => {
    expect(getAdminOrderStatusActions("paid", "bread_club")).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "canceled" })]),
    );
    expect(getAdminOrderStatusActions("canceled", "bread_club")).toEqual([]);
  });

  it("identifies when admin status changes must adjust inventory reservations", () => {
    expect(getAdminOrderInventoryAdjustment("pending_payment", "canceled")).toBe(
      "release",
    );
    expect(getAdminOrderInventoryAdjustment("pending_approval", "canceled")).toBeNull();
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
