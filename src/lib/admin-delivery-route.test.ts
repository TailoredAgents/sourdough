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
    source: "storefront",
    membershipId: null,
    breadClubFulfillmentId: null,
    stripeInvoiceId: null,
    customerName: "Test Customer",
    customerEmail: "customer@example.com",
    customerPhone: "4045550100",
    weeklyMenuId: "menu-1",
    weeklyMenuName: "Sunday, July 26 delivery",
    deliveryWindowLabel: "Sunday, July 26, 3:00 PM-6:00 PM",
    status: "paid",
    subtotalCents: 1200,
    deliveryFeeCents: 700,
    taxCents: 0,
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

  it("never mixes orders from different Sunday delivery weeks", () => {
    const orders = [
      orderFixture({ id: "selected-paid", weeklyMenuId: "menu-1", status: "paid" }),
      orderFixture({ id: "selected-baking", weeklyMenuId: "menu-1", status: "baking" }),
      orderFixture({ id: "other-week", weeklyMenuId: "menu-2", status: "paid" }),
    ];

    expect(
      getSundayRouteCandidateOrders(orders, "menu-1").map((order) => order.id),
    ).toEqual(["selected-paid", "selected-baking"]);
  });

  it("combines multiple orders going to the same physical stop", async () => {
    mocks.getOptimizedGoogleDrivingRoute.mockResolvedValue({
      durationSeconds: 900,
      distanceMeters: 8047,
      optimizedIntermediateWaypointIndex: [0],
    });
    const route = await buildAdminSundayRoute([
      orderFixture({ id: "base-order" }),
      orderFixture({
        id: "addon-order",
        source: "bread_club_addon",
        customerName: "Second Customer",
        customerPhone: "7705550101",
        items: [
          {
            id: "addon-item",
            productId: "product-2",
            productName: "Cinnamon Roll",
            quantity: 2,
            unitPriceCents: 500,
          },
        ],
      }),
    ]);

    expect(route.stops).toHaveLength(1);
    expect(route.stops[0]?.orderIds).toEqual(["base-order", "addon-order"]);
    expect(route.stops[0]?.orderSummary).toContain("Classic Country Loaf");
    expect(route.stops[0]?.orderSummary).toContain("Cinnamon Roll");
    expect(route.stops[0]?.customerContacts).toEqual([
      { name: "Test Customer", phone: "4045550100" },
      { name: "Second Customer", phone: "7705550101" },
    ]);
  });

  it("does not collapse distinct customer names that happen to overlap", async () => {
    mocks.getOptimizedGoogleDrivingRoute.mockResolvedValue({
      durationSeconds: 900,
      distanceMeters: 8047,
      optimizedIntermediateWaypointIndex: [0],
    });

    const route = await buildAdminSundayRoute([
      orderFixture({ customerName: "Joann", customerPhone: "4045550100" }),
      orderFixture({
        id: "ann-order",
        customerName: "Ann",
        customerPhone: "7705550101",
      }),
    ]);

    expect(route.stops[0]?.customerName).toBe("Joann / Ann");
    expect(route.stops[0]?.customerContacts).toHaveLength(2);
  });

  it("keeps the selected week name when there are no active stops", async () => {
    const route = await buildAdminSundayRoute([], "menu-3", "Sunday, Aug 9 delivery");
    expect(route.weeklyMenuId).toBe("menu-3");
    expect(route.weeklyMenuName).toBe("Sunday, Aug 9 delivery");
    expect(route.stops).toEqual([]);
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
    expect(route.weeklyMenuId).toBe("menu-1");
    expect(route.weeklyMenuName).toBe("Sunday, July 26 delivery");
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
