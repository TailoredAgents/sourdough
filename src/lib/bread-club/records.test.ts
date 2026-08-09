import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPendingBreadClubCheckout } from "./records";
import type {
  BreadClubCheckoutRequest,
  BreadClubDeliveryPrice,
  BreadClubEnrollmentWeek,
  BreadClubPlan,
} from "./types";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  memberships: [] as Record<string, unknown>[],
  cycles: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdminClient: () => ({
    from: mocks.from,
    rpc: mocks.rpc,
  }),
}));

const productId = "20000000-0000-4000-8000-000000000001";
const plan: BreadClubPlan = {
  id: "10000000-0000-4000-8000-000000000002",
  slug: "variety",
  name: "Variety Club",
  description: "One loaf each Sunday.",
  priceCents: 5200,
  loavesPerWeek: 1,
  active: true,
  sortOrder: 20,
  stripeProductId: "prod_variety",
  stripePriceId: "price_variety",
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
const deliveryPrice: BreadClubDeliveryPrice = {
  id: "11000000-0000-4000-8000-000000000002",
  bandKey: "11-20",
  label: "Local delivery, 11-20 minutes",
  minMinutes: 11,
  maxMinutes: 20,
  priceCents: 2800,
  stripeProductId: "prod_delivery",
  stripePriceId: "price_delivery",
  stripePriceCents: 2800,
  stripeLookupKey: "bread_club_delivery_11_20_4week_v1",
};
const checkout: BreadClubCheckoutRequest = {
  checkoutAttemptId: "90000000-0000-4000-8000-000000000001",
  planId: plan.id,
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
  deliveryInstructions: "Leave by the front door.",
  acknowledgedAutoRenewal: true,
  consentText:
    "I authorize $80.00 today and every four weeks until I cancel online or by email.",
};
const weeks: BreadClubEnrollmentWeek[] = Array.from(
  { length: 4 },
  (_, index) => {
    const suffix = String(index + 1).padStart(12, "0");
    return {
      weeklyMenu: {
        id: `30000000-0000-4000-8000-${suffix}`,
        name: `Sunday ${index + 1}`,
        orderCutoffAt: `2026-08-${String(7 + index * 7).padStart(2, "0")}T04:00:00.000Z`,
        startsAt: "2026-08-01T04:00:00.000Z",
        endsAt: "2026-08-31T03:59:00.000Z",
        published: true,
        items: [],
      },
      deliveryWindow: {
        id: `40000000-0000-4000-8000-${suffix}`,
        weeklyMenuId: `30000000-0000-4000-8000-${suffix}`,
        label: `Sunday ${index + 1}, 3:00 PM-6:00 PM`,
        startsAt: `2026-08-${String(9 + index * 7).padStart(2, "0")}T19:00:00.000Z`,
        endsAt: `2026-08-${String(9 + index * 7).padStart(2, "0")}T22:00:00.000Z`,
        capacity: 20,
        reserved: 0,
      },
      menu: [
        {
          ...plan.eligibleProducts[0],
          productId,
          category: "bread" as const,
          active: true,
          availableQuantity: 20,
          soldQuantity: 0,
          remainingQuantity: 20,
        },
      ],
      selection: [],
    };
  },
);

beforeEach(() => {
  mocks.from.mockReset();
  mocks.rpc.mockReset();
  mocks.memberships.length = 0;
  mocks.cycles.length = 0;
  mocks.rpc.mockResolvedValue({
    data: {
      membership_id: "60000000-0000-4000-8000-000000000001",
      cycle_id: "70000000-0000-4000-8000-000000000001",
      customer_id: "50000000-0000-4000-8000-000000000001",
      checkout_cancel_token: "a".repeat(48),
      first_delivery_at: weeks[0].deliveryWindow.startsAt,
      cycle_total_cents: 8000,
      checkout_expires_at: "2026-07-27T13:00:00.000Z",
      checkout_automatic_tax_enabled: false,
      plan_stripe_price_id: "price_variety",
      delivery_stripe_price_id: "price_delivery",
      route_band_key: "11-20",
      replayed: false,
    },
    error: null,
  });
  mocks.from.mockImplementation((table: string) => {
    if (table === "customers") {
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: { id: "50000000-0000-4000-8000-000000000001" },
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === "bread_club_memberships") {
      return {
        insert: (row: Record<string, unknown>) => {
          mocks.memberships.push(row);
          return {
            select: () => ({
              single: async () => ({
                data: { id: "60000000-0000-4000-8000-000000000001" },
                error: null,
              }),
            }),
          };
        },
        delete: () => ({ eq: async () => ({ error: null }) }),
      };
    }
    if (table === "bread_club_cycles") {
      return {
        insert: (row: Record<string, unknown>) => {
          mocks.cycles.push(row);
          return {
            select: () => ({
              single: async () => ({
                data: { id: "70000000-0000-4000-8000-000000000001" },
                error: null,
              }),
            }),
          };
        },
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
});

describe("Bread Club checkout persistence", () => {
  it("persists one cycle and atomically requests four Sunday reservations", async () => {
    const result = await createPendingBreadClubCheckout({
      checkout,
      consentIpHash: "hashed-ip",
      consentVersion: "2026-07-26",
      checkoutRequestHash: "b".repeat(64),
      automaticTaxEnabled: false,
      deliveryCheck: {
        eligible: true,
        preliminary: false,
        provider: "google_routes",
        providerStatus: "ok",
        needsReview: false,
        miles: 5.4,
        durationMinutes: 12,
        distanceMeters: 8690,
        distanceMiles: 5.4,
        pricingBand: "11-20",
        message: "Delivery is available.",
        feeCents: 700,
        postalCode: "30114",
        allowedPostalCodes: ["30114"],
      },
      deliveryPrice,
      plan,
      selection: checkout.selection,
      weeks,
    });

    expect(result.cycleTotalCents).toBe(8000);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "create_bread_club_subscription_checkout",
      expect.objectContaining({
        p_checkout_attempt_id: checkout.checkoutAttemptId,
        p_checkout_request_hash: "b".repeat(64),
        p_plan_id: plan.id,
        p_delivery_price_id: deliveryPrice.id,
        p_expected_plan_price_cents: 5200,
        p_expected_delivery_price_cents: 2800,
        p_automatic_tax_enabled: false,
        p_default_selection: [{ product_id: productId, quantity: 1 }],
        p_fulfillments: expect.arrayContaining([
          expect.objectContaining({
            weekly_menu_id: weeks[0].weeklyMenu.id,
            delivery_window_id: weeks[0].deliveryWindow.id,
            selection: [{ product_id: productId, quantity: 1 }],
          }),
        ]),
      }),
    );
    expect(
      mocks.rpc.mock.calls[0][1].p_fulfillments,
    ).toHaveLength(4);
  });
});
