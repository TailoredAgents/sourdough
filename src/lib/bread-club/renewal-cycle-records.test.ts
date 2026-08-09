import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findPendingCycleForMembership,
  prepareNextBreadClubCycle,
} from "./records";
import type { BreadClubEnrollmentData } from "./types";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  ensureRollingWeeklyMenus: vi.fn(),
  getBreadClubEnrollmentData: vi.fn(),
  pendingCycle: null as Record<string, unknown> | null,
  pendingFulfillments: [] as Record<string, unknown>[],
  existingFulfillments: [] as Record<string, unknown>[],
  latestCycle: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }),
}));
vi.mock("@/lib/rolling-weeks", () => ({
  ensureRollingWeeklyMenus: mocks.ensureRollingWeeklyMenus,
}));
vi.mock("./data", () => ({
  getBreadClubEnrollmentData: mocks.getBreadClubEnrollmentData,
}));

const membershipId = "50000000-0000-4000-8000-000000000001";
const planId = "10000000-0000-4000-8000-000000000001";
const productId = "20000000-0000-4000-8000-000000000001";

const enrollment = {
  plans: [
    {
      id: planId,
      slug: "variety",
      name: "Variety Club",
      description: "One loaf each Sunday.",
      priceCents: 5200,
      loavesPerWeek: 1,
      active: true,
      sortOrder: 1,
      stripeProductId: "prod_plan",
      stripePriceId: "price_plan",
      stripePriceCents: 5200,
      stripeLookupKey: "bread_club_variety_4week_v1",
      eligibleProducts: [
        {
          id: productId,
          name: "Country loaf",
          description: "Test loaf",
          imageUrl: null,
          imageStyle: "from-stone-100 to-amber-100",
          ingredients: ["Flour", "Water", "Salt"],
          allergens: ["Wheat"],
          priceCents: 1300,
          guaranteed: true,
          estimatedIngredientCostCents: 300,
        },
      ],
    },
  ],
  deliveryPrices: [
    {
      id: "11000000-0000-4000-8000-000000000001",
      bandKey: "11-20",
      label: "11-20 minutes",
      minMinutes: 11,
      maxMinutes: 20,
      priceCents: 2800,
      stripeProductId: "prod_delivery",
      stripePriceId: "price_delivery",
      stripePriceCents: 2800,
      stripeLookupKey: "bread_club_delivery_11_20_4week_v1",
    },
  ],
  weeks: Array.from({ length: 4 }, (_, index) => {
    const suffix = String(index + 1).padStart(12, "0");
    return {
      weeklyMenu: {
        id: `30000000-0000-4000-8000-${suffix}`,
        name: `Week ${index + 1}`,
        orderCutoffAt: `2099-08-${String(6 + index * 7).padStart(2, "0")}T04:00:00Z`,
        startsAt: "2099-08-01T04:00:00Z",
        endsAt: "2099-09-01T03:59:00Z",
        published: true,
        items: [],
      },
      deliveryWindow: {
        id: `40000000-0000-4000-8000-${suffix}`,
        weeklyMenuId: `30000000-0000-4000-8000-${suffix}`,
        label: `Sunday ${index + 1}`,
        startsAt: `2099-08-${String(8 + index * 7).padStart(2, "0")}T19:00:00Z`,
        endsAt: `2099-08-${String(8 + index * 7).padStart(2, "0")}T22:00:00Z`,
        capacity: 20,
        reserved: 0,
      },
      menu: [
        {
          id: productId,
          productId,
          name: "Country loaf",
          category: "bread",
          description: "Test loaf",
          ingredients: ["Flour", "Water", "Salt"],
          allergens: ["Wheat"],
          priceCents: 1300,
          estimatedIngredientCostCents: 300,
          imageUrl: null,
          imageStyle: "from-stone-100 to-amber-100",
          active: true,
          featured: true,
          unavailable: false,
          availableQuantity: 20,
          soldQuantity: 0,
          remainingQuantity: 20,
          stripeProductId: "prod_loaf",
          stripePriceId: "price_loaf",
          stripePriceCents: 1300,
          stripeSyncedAt: "2099-01-01T00:00:00Z",
        },
      ],
      selection: [],
    };
  }),
  settings: {
    maxWeeklyLoafSlots: 10,
    skipLimitPerCycle: 1,
    rolloverCreditDays: 60,
    taxStatus: "pending",
    consentVersion: "2026-07-26",
  },
  publicEnabled: true,
} satisfies BreadClubEnrollmentData;

const membership = {
  id: membershipId,
  plan_id: planId,
  pending_plan_id: null,
  default_selection: [{ product_id: productId, quantity: 1 }],
  route_fee_cents: 700,
  route_band_key: "11-20",
  pending_route_fee_cents: null,
  pending_route_band_key: null,
  pending_delivery_address: null,
  pending_delivery_check: null,
  stripe_current_period_end: "2099-08-01T00:00:00Z",
};

function pendingCycle() {
  return {
    id: "70000000-0000-4000-8000-000000000001",
    cycle_number: 2,
    status: "pending_payment",
    period_start: "2099-08-01T00:00:00Z",
    period_end: "2099-08-29T00:00:00Z",
    plan_price_cents: 5200,
    delivery_price_cents: 2800,
    total_cents: 8000,
  };
}

beforeEach(() => {
  mocks.from.mockReset();
  mocks.rpc.mockReset();
  mocks.ensureRollingWeeklyMenus.mockReset();
  mocks.getBreadClubEnrollmentData.mockReset();
  mocks.pendingCycle = null;
  mocks.pendingFulfillments = [];
  mocks.existingFulfillments = [];
  mocks.latestCycle = {
    cycle_number: 1,
    plan_price_cents: 5200,
    delivery_price_cents: 2800,
  };
  mocks.ensureRollingWeeklyMenus.mockResolvedValue([]);
  mocks.getBreadClubEnrollmentData.mockResolvedValue(enrollment);
  mocks.rpc.mockResolvedValue({
    data: [
      {
        renewal_cycle_id: "70000000-0000-4000-8000-000000000002",
        renewal_cycle_number: 2,
        replayed: false,
        repaired: false,
      },
    ],
    error: null,
  });
  mocks.from.mockImplementation((table: string) => {
    if (table === "bread_club_cycles") {
      return {
        select: (columns: string) => ({
          eq: () =>
            columns.includes("status, period_start")
              ? {
                  in: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: async () => ({
                          data: mocks.pendingCycle,
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }
              : {
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({
                        data: mocks.latestCycle,
                        error: null,
                      }),
                    }),
                  }),
                },
        }),
      };
    }
    if (table === "bread_club_fulfillments") {
      return {
        select: (columns: string) => ({
          eq: async () => ({
            data:
              columns === "id, order_id"
                ? mocks.pendingFulfillments
                : mocks.existingFulfillments,
            error: null,
          }),
        }),
      };
    }
    if (table === "bread_club_memberships") {
      return {
        select: () => ({
          eq: () => ({
            in: () => ({
              maybeSingle: async () => ({ data: membership, error: null }),
            }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
});

describe("Bread Club renewal-cycle persistence", () => {
  it("creates and reserves a renewal through one database command", async () => {
    const result = await prepareNextBreadClubCycle(
      membershipId,
      new Date("2099-07-20T00:00:00Z"),
    );

    expect(result).toEqual({
      id: "70000000-0000-4000-8000-000000000002",
      cycleNumber: 2,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "ensure_atomic_bread_club_renewal_cycle",
      expect.objectContaining({
        p_membership_id: membershipId,
        p_cycle_number: 2,
        p_plan_price_cents: 5200,
        p_delivery_price_cents: 2800,
        p_total_cents: 8000,
        p_fulfillments: expect.arrayContaining([
          expect.objectContaining({
            weekly_menu_id: enrollment.weeks[0].weeklyMenu.id,
            delivery_window_id: enrollment.weeks[0].deliveryWindow.id,
          }),
        ]),
      }),
    );
  });

  it("replays a complete pending renewal through the locked command", async () => {
    mocks.pendingCycle = pendingCycle();
    mocks.pendingFulfillments = Array.from({ length: 4 }, (_, index) => ({
      id: `80000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      order_id: `90000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    }));
    mocks.rpc.mockResolvedValue({
      data: [
        {
          renewal_cycle_id: pendingCycle().id,
          renewal_cycle_number: 2,
          replayed: true,
          repaired: false,
        },
      ],
      error: null,
    });

    await expect(prepareNextBreadClubCycle(membershipId)).resolves.toEqual({
      id: pendingCycle().id,
      cycleNumber: 2,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "ensure_atomic_bread_club_renewal_cycle",
      expect.objectContaining({ p_fulfillments: null }),
    );
    expect(mocks.ensureRollingWeeklyMenus).not.toHaveBeenCalled();
  });

  it("does not expose an incomplete pending cycle to invoice handling", async () => {
    mocks.pendingCycle = pendingCycle();
    mocks.pendingFulfillments = [];

    await expect(
      findPendingCycleForMembership(membershipId),
    ).rejects.toThrow(/four complete fulfillment orders/i);
  });

  it("sends an empty legacy cycle back through the repair command", async () => {
    mocks.pendingCycle = pendingCycle();
    mocks.pendingFulfillments = [];
    mocks.rpc.mockResolvedValue({
      data: [
        {
          renewal_cycle_id: pendingCycle().id,
          renewal_cycle_number: 2,
          replayed: false,
          repaired: true,
        },
      ],
      error: null,
    });

    await expect(prepareNextBreadClubCycle(membershipId)).resolves.toEqual({
      id: pendingCycle().id,
      cycleNumber: 2,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "ensure_atomic_bread_club_renewal_cycle",
      expect.objectContaining({
        p_cycle_number: 2,
        p_period_start: "2099-08-01T00:00:00.000Z",
        p_period_end: "2099-08-29T00:00:00.000Z",
        p_fulfillments: expect.any(Array),
      }),
    );
  });
});
