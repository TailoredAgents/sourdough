import { describe, expect, it } from "vitest";
import {
  getCustomerOrderStatusLabel,
  getCustomerOrderStatusMessage,
} from "./order-status";

describe("customer order status copy", () => {
  it("uses customer-safe labels instead of raw database statuses", () => {
    expect(getCustomerOrderStatusLabel("pending_payment")).toBe(
      "Payment being confirmed",
    );
    expect(getCustomerOrderStatusLabel("out_for_delivery")).toBe(
      "Out for delivery",
    );
  });

  it("explains webhook timing for pending payment orders", () => {
    expect(getCustomerOrderStatusMessage("pending_payment")).toContain(
      "Stripe is confirming payment",
    );
  });
});
