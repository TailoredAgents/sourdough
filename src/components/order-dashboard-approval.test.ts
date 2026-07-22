import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OrderDashboard } from "./order-dashboard";
import type { AdminOrder } from "@/lib/types";

const approvalOrder: AdminOrder = {
  id: "11111111-1111-4111-8111-111111111111",
  customerName: "Same Week Customer",
  customerEmail: "customer@example.com",
  customerPhone: "4045550100",
  weeklyMenuId: "22222222-2222-4222-8222-222222222222",
  weeklyMenuName: "Launch Week Bake Drop",
  deliveryWindowLabel: "Thursday, Jul 23, 9:00 AM-12:00 PM",
  status: "pending_approval",
  subtotalCents: 2400,
  deliveryFeeCents: 600,
  totalCents: 3000,
  deliveryAddress: {
    line1: "123 Main Street",
    line2: "",
    city: "Canton",
    state: "GA",
    postalCode: "30114",
    email: "customer@example.com",
    phone: "4045550100",
  },
  deliveryMiles: 4.2,
  deliveryInstructions: "Leave by the front door.",
  deliveryCheck: null,
  notes: "Please slice if possible.",
  paidAt: "2026-07-22T14:00:00.000Z",
  createdAt: "2026-07-22T14:00:00.000Z",
  updatedAt: "2026-07-22T14:00:00.000Z",
  stripeCheckoutSessionId: "cs_approval",
  checkoutCancelToken: "cancel-token",
  nextWeekOk: true,
  approvalMode: "after_cutoff",
  approvedAt: null,
  deniedAt: null,
  refundedAt: null,
  stripeRefundId: null,
  adminDecisionNote: null,
  items: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      productId: "44444444-4444-4444-8444-444444444444",
      productName: "Classic Country Loaf",
      quantity: 2,
      unitPriceCents: 1200,
    },
  ],
  moveWindows: [
    {
      id: "55555555-5555-4555-8555-555555555555",
      label: "Thursday, Jul 30, 9:00 AM-12:00 PM",
      weeklyMenuId: "66666666-6666-4666-8666-666666666666",
      weeklyMenuName: "Next Week Bake Drop",
      startsAt: "2026-07-30T13:00:00.000Z",
      capacity: 12,
      reserved: 3,
    },
  ],
};

describe("order dashboard approval request display", () => {
  it("renders same-week approval requests with clear owner decision controls", () => {
    const html = renderToStaticMarkup(
      React.createElement(OrderDashboard, { initialOrders: [approvalOrder] }),
    );

    expect(html).toContain("Needs approval");
    expect(html).toContain("Same Week Customer");
    expect(html).toContain("customer@example.com");
    expect(html).toContain("4045550100");
    expect(html).toContain("Paid same-week request needs a decision");
    expect(html).toContain("Next week works: Yes");
    expect(html).toContain("Accept request");
    expect(html).toContain("Deny &amp; refund");
    expect(html).toContain("Move to next week");
    expect(html).toContain("Next Week Bake Drop");
    expect(html).toContain("Classic Country Loaf");
    expect(html).toContain("Please slice if possible.");
    expect(html).toContain("Stripe session: cs_approval");
    expect(html).toContain("$30.00");
  });
});
