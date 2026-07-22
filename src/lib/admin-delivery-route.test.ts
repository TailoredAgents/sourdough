import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAdminSundayRoute,
  getSundayRouteCandidateOrders,
} from "./admin-delivery-route";
import type { AdminOrder } from "./types";

const mocks = vi.hoisted(() => ({
  getOptimizedGoogleDrivingRoute: vi.fn(),
}));

vi.mock("./delivery", () => ({
  formatDeliveryAddress: (address: AdminOrder["deliveryAddress"]) =>
    `${address.line1}, ${address.city}, ${address.state} ${address.postalCode}`,
  getDeliveryOriginAddress: () =>
    "4501 Holly Springs Parkway, Canton, GA 30115",
  getDeliveryRouteEndAddress: () =>
    "403 Three Branches Ct, Woodstock, GA 30188",
  getOptimizedGoogleDrivingRoute: mocks.getOptimizedGoogleDrivingRoute,
}));

function orderFixture(patch: Partial<AdminOrder>): AdminOrder {
  return {
    id: "order-1",
    customerName: "Test Customer",
    customerEmail: "customer@example.com",
    customerPhone: "4045550100",
    weeklyMenuId: "menu-1",
    weeklyMenuName: "Sunday, July 26 delivery",
    deliveryWindowLabel: "Sunday, July 26, 3:00 PM-6:00 PM",
    status: "paid",
    subtotalCents: 1200,
    deliveryFeeCents: 700,
    totalCents: 1900,
    deliveryAddress: {
      line1: "123 Main St",
      line2: "",
      city: "Canton",
      state: "GA",
      postalCode: "30114",
    },
    deliveryMiles: null,
    deliveryInstructions: "Leave at the door.",
    deliveryCheck: null,
    notes: "Ring once.",
    paidAt: "2026-07-22T12:00:00.000Z",
    createdAt: "2026-07-22T12:00:00.000Z",
    updatedAt: "2026-07-22T12:00:00.000Z",
    stripeCheckoutSessionId: "cs_test_123",
    checkoutCancelToken: null,
    nextWeekOk: null,
    approvalMode: "standard",
    approvedAt: null,
    deniedAt: null,
    refundedAt: null,
    stripeRefundId: null,
    adminDecisionNote: null,
    items: [
      {
        id: "item-1",
        productId: "product-1",
        productName: "Classic Country Loaf",
        quantity: 1,
        unitPriceCents: 1200,
      },
    ],
    moveWindows: [],
    ...patch,
  };
}

beforeEach(() => {
  mocks.getOptimizedGoogleDrivingRoute.mockReset();
});

describe("admin Sunday delivery route", () => {
  it("includes only paid active delivery orders", () => {
    const orders = [
      orderFixture({ id: "paid", status: "paid" }),
      orderFixture({ id: "baking", status: "baking" }),
      orderFixture({ id: "out", status: "out_for_delivery" }),
      orderFixture({ id: "pending", status: "pending_payment" }),
      orderFixture({ id: "approval", status: "pending_approval" }),
      orderFixture({ id: "canceled", status: "canceled" }),
      orderFixture({ id: "delivered", status: "delivered" }),
    ];

    expect(getSundayRouteCandidateOrders(orders).map((order) => order.id)).toEqual([
      "paid",
      "baking",
      "out",
    ]);
  });

  it("uses Google's optimized waypoint order for the owner route", async () => {
    mocks.getOptimizedGoogleDrivingRoute.mockResolvedValue({
      durationSeconds: 3600,
      distanceMeters: 32186.88,
      optimizedIntermediateWaypointIndex: [1, 0],
    });

    const route = await buildAdminSundayRoute([
      orderFixture({ id: "stop-a", customerName: "Alpha" }),
      orderFixture({
        id: "stop-b",
        customerName: "Beta",
        deliveryAddress: {
          line1: "456 Oak St",
          city: "Woodstock",
          state: "GA",
          postalCode: "30188",
        },
      }),
    ]);

    expect(route.durationMinutes).toBe(60);
    expect(route.distanceMiles).toBe(20);
    expect(route.stops.map((stop) => stop.customerName)).toEqual(["Beta", "Alpha"]);
    expect(route.mapsUrl).toContain("https://www.google.com/maps/dir/");
    expect(route.mapsUrl).toContain("waypoints=");
    expect(mocks.getOptimizedGoogleDrivingRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        intermediateAddresses: [
          "123 Main St, Canton, GA 30114",
          "456 Oak St, Woodstock, GA 30188",
        ],
      }),
    );
  });
});
