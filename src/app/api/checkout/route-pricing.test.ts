import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  checkDeliveryAddressWithRoutes: vi.fn(),
  createPendingCheckoutOrder: vi.fn(),
  attachStripeSessionToOrder: vi.fn(),
  releasePendingOrder: vi.fn(),
  getDeliverySettingsData: vi.fn(),
  getDeliveryWindowForMenuData: vi.fn(),
  getWeeklyMenuData: vi.fn(),
  getMenuProductData: vi.fn(),
  checkRateLimit: vi.fn(),
  getStripe: vi.fn(),
  stripeCreateSession: vi.fn(),
}));

vi.mock("@/lib/delivery", () => ({
  checkDeliveryAddressWithRoutes: mocks.checkDeliveryAddressWithRoutes,
}));

vi.mock("@/lib/email", () => ({
  sendCustomerOrderConfirmation: vi.fn(),
}));

vi.mock("@/lib/order-records", () => ({
  attachStripeSessionToOrder: mocks.attachStripeSessionToOrder,
  buildOrderSummary: (items: Array<{ quantity: number; name: string }>) =>
    items.map((item) => `${item.quantity} x ${item.name}`).join("\n"),
  createPendingCheckoutOrder: mocks.createPendingCheckoutOrder,
  releasePendingOrder: mocks.releasePendingOrder,
}));

vi.mock("@/lib/menu-availability", () => ({
  canOrderMenuProduct: () => true,
}));

vi.mock("@/lib/storefront-data", () => ({
  getDeliverySettingsData: mocks.getDeliverySettingsData,
  getDeliveryWindowForMenuData: mocks.getDeliveryWindowForMenuData,
  getWeeklyMenuData: mocks.getWeeklyMenuData,
  getMenuProductData: mocks.getMenuProductData,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: mocks.getStripe,
}));

vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return {
    ...actual,
    getSiteUrl: () => "https://landlsourdough.com",
  };
});

const checkoutPayload = {
  weeklyMenuId: "11111111-1111-4111-8111-111111111111",
  cart: [{ productId: "product-1", quantity: 1 }],
  customer: {
    name: "Test Customer",
    email: "customer@example.com",
    phone: "4045550100",
  },
  address: {
    line1: "123 Main Street",
    line2: "",
    city: "Canton",
    state: "GA",
    postalCode: "30114",
  },
  deliveryWindowId: "22222222-2222-4222-8222-222222222222",
  deliveryInstructions: "Leave at the door.",
  notes: "Thank you.",
  acknowledgedTerms: true,
};

const menuProduct = {
  id: "product-1",
  productId: "product-1",
  name: "Classic Country Loaf",
  category: "bread" as const,
  description: "A loaf.",
  ingredients: ["Flour"],
  allergens: ["Wheat"],
  priceCents: 1200,
  stripeProductId: "prod_123",
  stripePriceId: "price_123",
  stripePriceCents: 1200,
  stripeSyncedAt: "2026-07-22T12:00:00.000Z",
  imageUrl: null,
  imageStyle: "from-stone-100 to-amber-100",
  active: true,
  availableQuantity: 10,
  soldQuantity: 0,
  remainingQuantity: 10,
};

beforeEach(() => {
  mocks.checkDeliveryAddressWithRoutes.mockReset();
  mocks.createPendingCheckoutOrder.mockReset();
  mocks.attachStripeSessionToOrder.mockReset();
  mocks.releasePendingOrder.mockReset();
  mocks.getDeliverySettingsData.mockReset();
  mocks.getDeliveryWindowForMenuData.mockReset();
  mocks.getWeeklyMenuData.mockReset();
  mocks.getMenuProductData.mockReset();
  mocks.checkRateLimit.mockReset();
  mocks.getStripe.mockReset();
  mocks.stripeCreateSession.mockReset();

  mocks.checkRateLimit.mockResolvedValue({ allowed: true });
  mocks.getWeeklyMenuData.mockResolvedValue({
    id: checkoutPayload.weeklyMenuId,
    published: true,
    orderCutoffAt: "2099-07-24T04:00:00.000Z",
  });
  mocks.getDeliveryWindowForMenuData.mockResolvedValue({
    id: checkoutPayload.deliveryWindowId,
    label: "Sunday, July 26, 2099, 3:00 PM-6:00 PM",
    capacity: 20,
    reserved: 0,
    endsAt: "2099-07-26T22:00:00.000Z",
  });
  mocks.getDeliverySettingsData.mockResolvedValue({
    radiusMiles: 12,
    deliveryFeeCents: 600,
    allowedPostalCodes: ["30114"],
    serviceAreaCopy: "Delivery is available in selected local ZIP codes.",
    center: { lat: 34.2368, lng: -84.4908 },
  });
  mocks.getMenuProductData.mockResolvedValue(menuProduct);
  mocks.checkDeliveryAddressWithRoutes.mockResolvedValue({
    eligible: true,
    preliminary: false,
    provider: "google_routes",
    providerStatus: "ok",
    needsReview: false,
    miles: 8.7,
    durationMinutes: 21,
    distanceMeters: 14000,
    distanceMiles: 8.7,
    pricingBand: "21-30",
    message:
      "Delivery is available. This address is about 21 minutes from the bakery. Delivery fee: $10.00.",
    feeCents: 1000,
    postalCode: "30114",
    allowedPostalCodes: ["30114"],
  });
  mocks.createPendingCheckoutOrder.mockResolvedValue({
    id: "order-id",
    checkoutCancelToken: "cancel-token",
    approvalMode: "standard",
    orderSummary: "1 x Classic Country Loaf",
  });
  mocks.stripeCreateSession.mockResolvedValue({
    id: "cs_test_123",
    url: "https://checkout.stripe.com/c/test",
  });
  mocks.getStripe.mockReturnValue({
    checkout: {
      sessions: {
        create: mocks.stripeCreateSession,
      },
    },
  });
});

describe("checkout route delivery pricing", () => {
  it("recalculates delivery server-side and sends that exact fee to Stripe", async () => {
    const response = await POST(
      new Request("https://landlsourdough.com/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(checkoutPayload),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: "https://checkout.stripe.com/c/test",
    });
    expect(mocks.checkDeliveryAddressWithRoutes).toHaveBeenCalledWith(
      checkoutPayload.address,
      expect.anything(),
    );
    expect(mocks.createPendingCheckoutOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryCheck: expect.objectContaining({ feeCents: 1000 }),
      }),
    );
    expect(mocks.stripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: expect.arrayContaining([
          expect.objectContaining({
            price_data: expect.objectContaining({
              unit_amount: 1000,
              product_data: expect.objectContaining({
                name: "Local delivery",
              }),
            }),
          }),
        ]),
      }),
    );
  });
});
