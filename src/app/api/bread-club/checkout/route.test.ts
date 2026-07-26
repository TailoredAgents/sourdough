import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildBreadClubConsentText } from "@/lib/bread-club/pricing";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  getBreadClubEnrollmentData: vi.fn(),
  getDeliverySettingsData: vi.fn(),
  checkDeliveryAddressWithRoutes: vi.fn(),
  checkRateLimit: vi.fn(),
  createPendingBreadClubCheckout: vi.fn(),
  attachStripeSubscriptionCheckout: vi.fn(),
  markBreadClubCheckoutIncomplete: vi.fn(),
  stripeCreateSession: vi.fn(),
}));

vi.mock("@/lib/bread-club/config", () => ({
  getBreadClubCheckoutGate: () => ({ allowed: true, reason: null }),
  isBreadClubAutomaticTaxEnabled: () => false,
  isBreadClubTestCustomer: () => true,
}));
vi.mock("@/lib/bread-club/data", () => ({
  getBreadClubEnrollmentData: mocks.getBreadClubEnrollmentData,
}));
vi.mock("@/lib/bread-club/records", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/bread-club/records")>();
  return {
    ...actual,
    createPendingBreadClubCheckout:
      mocks.createPendingBreadClubCheckout,
    attachStripeSubscriptionCheckout:
      mocks.attachStripeSubscriptionCheckout,
    markBreadClubCheckoutIncomplete:
      mocks.markBreadClubCheckoutIncomplete,
  };
});
vi.mock("@/lib/delivery", () => ({
  checkDeliveryAddressWithRoutes:
    mocks.checkDeliveryAddressWithRoutes,
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
}));
vi.mock("@/lib/storefront-data", () => ({
  getDeliverySettingsData: mocks.getDeliverySettingsData,
}));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    checkout: {
      sessions: {
        create: mocks.stripeCreateSession,
      },
    },
  }),
}));
vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return {
    ...actual,
    getSiteUrl: () => "https://landlsourdough.com",
  };
});

const planId = "10000000-0000-4000-8000-000000000002";
const productId = "20000000-0000-4000-8000-000000000001";
const plan = {
  id: planId,
  slug: "variety",
  name: "Variety Club",
  description: "One loaf each Sunday.",
  priceCents: 5200,
  loavesPerWeek: 1,
  active: true,
  sortOrder: 20,
  stripeProductId: "prod_variety",
  stripePriceId: "price_variety_4week",
  stripePriceCents: 5200,
  stripeLookupKey: "bread_club_variety_4week_v1",
  eligibleProducts: [
    {
      id: productId,
      name: "Classic Country Loaf",
      description: "A dependable loaf.",
      imageUrl: null,
      imageStyle: "from-stone-100 to-amber-100",
      ingredients: ["Flour", "Water", "Salt"],
      allergens: ["Wheat"],
      priceCents: 1200,
      guaranteed: true,
      estimatedIngredientCostCents: 300,
    },
  ],
};
const deliveryPrice = {
  id: "11000000-0000-4000-8000-000000000002",
  bandKey: "11-20",
  label: "Local delivery, 11-20 minutes",
  minMinutes: 11,
  maxMinutes: 20,
  priceCents: 2800,
  stripeProductId: "prod_delivery",
  stripePriceId: "price_delivery_4week",
  stripePriceCents: 2800,
  stripeLookupKey: "bread_club_delivery_11_20_4week_v1",
};
const weeks = Array.from({ length: 4 }, (_, index) => {
  const suffix = String(index + 1).padStart(12, "0");
  const menuId = `30000000-0000-4000-8000-${suffix}`;
  return {
    weeklyMenu: {
      id: menuId,
      name: `Sunday ${index + 1}`,
      orderCutoffAt: "2099-08-01T04:00:00.000Z",
      startsAt: "2099-07-27T04:00:00.000Z",
      endsAt: "2099-08-03T03:59:00.000Z",
      published: true,
      items: [],
    },
    deliveryWindow: {
      id: `40000000-0000-4000-8000-${suffix}`,
      weeklyMenuId: menuId,
      label: `Sunday ${index + 1}, 3:00 PM-6:00 PM`,
      startsAt: "2099-08-02T19:00:00.000Z",
      endsAt: "2099-08-02T22:00:00.000Z",
      capacity: 20,
      reserved: 0,
    },
    menu: [
      {
        ...plan.eligibleProducts[0],
        productId,
        category: "bread",
        active: true,
        availableQuantity: 20,
        soldQuantity: 0,
        remainingQuantity: 20,
      },
    ],
    selection: [],
  };
});
const payload = {
  planId,
  selection: [{ productId, quantity: 1 }],
  customer: {
    name: "Bread Club Customer",
    email: "member@example.com",
    phone: "4045550100",
  },
  address: {
    line1: "123 Main Street",
    line2: "",
    city: "Canton",
    state: "GA",
    postalCode: "30114",
  },
  deliveryInstructions: "Leave at the front door.",
  acknowledgedAutoRenewal: true,
  consentText: buildBreadClubConsentText(8000, false),
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.checkRateLimit.mockResolvedValue({ allowed: true });
  mocks.getBreadClubEnrollmentData.mockResolvedValue({
    plans: [plan],
    deliveryPrices: [deliveryPrice],
    weeks,
    settings: {
      maxWeeklyLoafSlots: 10,
      skipLimitPerCycle: 1,
      rolloverCreditDays: 60,
      taxStatus: "pending",
      consentVersion: "2026-07-26",
    },
    publicEnabled: false,
  });
  mocks.getDeliverySettingsData.mockResolvedValue({
    deliveryFeeCents: 700,
    allowedPostalCodes: ["30114"],
  });
  mocks.checkDeliveryAddressWithRoutes.mockResolvedValue({
    eligible: true,
    preliminary: false,
    provider: "google_routes",
    providerStatus: "ok",
    feeCents: 700,
    durationMinutes: 12,
    postalCode: "30114",
    message: "Delivery is available.",
  });
  mocks.createPendingBreadClubCheckout.mockResolvedValue({
    membershipId: "50000000-0000-4000-8000-000000000001",
    cycleId: "60000000-0000-4000-8000-000000000001",
    customerId: "70000000-0000-4000-8000-000000000001",
    checkoutCancelToken: "cancel-token",
    firstDeliveryAt: weeks[0].deliveryWindow.startsAt,
    cycleTotalCents: 8000,
  });
  mocks.stripeCreateSession.mockResolvedValue({
    id: "cs_bread_club",
    url: "https://checkout.stripe.com/c/bread-club",
  });
});

describe("Bread Club subscription checkout", () => {
  it("rechecks the address and sends the exact two recurring Prices to Stripe", async () => {
    const response = await POST(
      new Request("https://landlsourdough.com/api/bread-club/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      url: "https://checkout.stripe.com/c/bread-club",
      recurringTotalCents: 8000,
      taxTreatment: "not_added",
    });
    expect(mocks.checkDeliveryAddressWithRoutes).toHaveBeenCalledWith(
      payload.address,
      expect.anything(),
    );
    expect(mocks.createPendingBreadClubCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        plan,
        deliveryPrice,
        selection: [{ productId, quantity: 1 }],
        weeks,
      }),
    );
    expect(mocks.stripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        line_items: [
          { price: "price_variety_4week", quantity: 1 },
          { price: "price_delivery_4week", quantity: 1 },
        ],
        automatic_tax: { enabled: false },
        metadata: expect.objectContaining({
          checkout_kind: "bread_club_subscription",
          bread_club_plan_id: planId,
          delivery_band: "11-20",
        }),
        subscription_data: {
          metadata: expect.objectContaining({
            bread_club_membership_id:
              "50000000-0000-4000-8000-000000000001",
          }),
        },
      }),
    );
    expect(mocks.attachStripeSubscriptionCheckout).toHaveBeenCalledWith(
      "50000000-0000-4000-8000-000000000001",
      "cs_bread_club",
    );
  });

  it("blocks checkout when the server-side Routes check fails", async () => {
    mocks.checkDeliveryAddressWithRoutes.mockResolvedValue({
      eligible: false,
      preliminary: false,
      provider: "google_routes",
      providerStatus: "over_limit",
      feeCents: 0,
      durationMinutes: 31,
      postalCode: "30114",
      message: "This address is outside the 30-minute delivery range.",
    });
    const response = await POST(
      new Request("https://landlsourdough.com/api/bread-club/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.createPendingBreadClubCheckout).not.toHaveBeenCalled();
    expect(mocks.stripeCreateSession).not.toHaveBeenCalled();
  });

  it("rejects browser consent text that does not match the server total", async () => {
    const response = await POST(
      new Request("https://landlsourdough.com/api/bread-club/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          consentText:
            "I authorize a different amount today and every four weeks until I cancel online.",
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.createPendingBreadClubCheckout).not.toHaveBeenCalled();
    expect(mocks.stripeCreateSession).not.toHaveBeenCalled();
  });
});
