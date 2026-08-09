import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BreadClubDeliveryPrice, BreadClubPlan } from "./types";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  getMember: vi.fn(),
  getCatalog: vi.fn(),
  getDeliverySettings: vi.fn(),
  checkDeliveryAddress: vi.fn(),
  reconcileProvider: vi.fn(),
  sendPlanChange: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }),
}));
vi.mock("@/lib/delivery", () => ({
  checkDeliveryAddressWithRoutes: mocks.checkDeliveryAddress,
}));
vi.mock("@/lib/storefront-data", () => ({
  getDeliverySettingsData: mocks.getDeliverySettings,
}));
vi.mock("./data", () => ({ getBreadClubCatalogData: mocks.getCatalog }));
vi.mock("./member-data", () => ({
  getBreadClubMemberData: mocks.getMember,
}));
vi.mock("./provider-sync", () => ({
  reconcileBreadClubProviderState: mocks.reconcileProvider,
}));
vi.mock("./emails", () => ({
  sendBreadClubCancellation: vi.fn(),
  sendBreadClubAddonReceipt: vi.fn(),
  sendBreadClubPlanChange: mocks.sendPlanChange,
  sendBreadClubSkipCredit: vi.fn(),
}));

import {
  scheduleBreadClubPlanChange,
  updateBreadClubAddress,
} from "./member-actions";

const membershipId = "10000000-0000-4000-8000-000000000001";
const productId = "20000000-0000-4000-8000-000000000001";
const plan: BreadClubPlan = {
  id: "30000000-0000-4000-8000-000000000001",
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
      name: "Classic Country",
      description: "A dependable loaf.",
      imageUrl: null,
      imageStyle: "from-stone-100 to-amber-100",
      ingredients: ["Flour", "Water", "Salt"],
      allergens: ["Wheat"],
      priceCents: 1300,
      guaranteed: true,
      estimatedIngredientCostCents: 300,
    },
  ],
};
const deliveryPrice: BreadClubDeliveryPrice = {
  id: "40000000-0000-4000-8000-000000000001",
  bandKey: "11-20",
  label: "Local delivery, 11-20 minutes",
  minMinutes: 11,
  maxMinutes: 20,
  priceCents: 2800,
  stripeProductId: "prod_delivery",
  stripePriceId: "price_delivery_11_20",
  stripePriceCents: 2800,
  stripeLookupKey: "bread_club_delivery_11_20_4week_v1",
};
const address = {
  line1: "99 New Street",
  line2: "",
  city: "Canton",
  state: "GA",
  postalCode: "30114",
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getMember.mockResolvedValue({
    id: membershipId,
    customerName: "Provider Member",
    customerEmail: "member@example.com",
    customerPhone: "7705550100",
    fulfillments: [],
  });
  mocks.getCatalog.mockResolvedValue({
    plans: [plan],
    deliveryPrices: [deliveryPrice],
  });
  mocks.getDeliverySettings.mockResolvedValue({});
  mocks.checkDeliveryAddress.mockResolvedValue({
    eligible: true,
    preliminary: false,
    needsReview: false,
    miles: 8,
    durationMinutes: 15,
    distanceMiles: 8,
    message: "Delivery is available.",
    feeCents: 700,
    postalCode: "30114",
    allowedPostalCodes: ["30114"],
  });
  mocks.from.mockImplementation((table: string) => {
    if (table !== "bread_club_cycles") {
      throw new Error(`Unexpected table ${table}`);
    }
    return {
      select: () => ({
        eq: () => ({
          in: async () => ({ count: 0, error: null }),
        }),
      }),
    };
  });
  mocks.rpc.mockResolvedValue({ data: 7, error: null });
  mocks.reconcileProvider.mockRejectedValue(
    new Error("Stripe request timed out"),
  );
});

describe("Bread Club desired-state member changes", () => {
  it("keeps a committed plan change queued after an ambiguous Stripe result", async () => {
    await expect(
      scheduleBreadClubPlanChange(membershipId, plan.id, [
        { productId, quantity: 1 },
      ]),
    ).rejects.toThrow(
      "Your plan choice was saved, but Stripe is still syncing it.",
    );

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "begin_bread_club_plan_provider_change",
      expect.objectContaining({ p_membership_id: membershipId }),
    );
    expect(mocks.reconcileProvider).toHaveBeenCalledWith(membershipId, 7);
    expect(mocks.sendPlanChange).not.toHaveBeenCalled();
  });

  it("keeps a committed address and per-Sunday fee queued after an ambiguous Stripe result", async () => {
    await expect(
      updateBreadClubAddress(membershipId, address, "Side porch"),
    ).rejects.toThrow(
      "Your delivery change was saved, but Stripe is still syncing it.",
    );

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "begin_bread_club_address_provider_change",
      expect.objectContaining({
        p_membership_id: membershipId,
        p_route_fee_cents: 700,
        p_route_band_key: "11-20",
      }),
    );
    expect(mocks.reconcileProvider).toHaveBeenCalledWith(membershipId, 7);
  });
});
