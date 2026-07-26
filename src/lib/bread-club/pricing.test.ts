import { describe, expect, it } from "vitest";
import {
  buildBreadClubConsentText,
  canReserveBreadClubLoafSlots,
  estimatePlanContributionCents,
  getBreadClubDeliveredTotals,
  getBreadClubDeliveryBandKey,
  getBreadClubCycleTotalCents,
  getBreadClubRenewalPricing,
  normalizeBreadClubSelection,
  validateBreadClubSelection,
} from "./pricing";
import type { BreadClubPlan } from "./types";

const plan: BreadClubPlan = {
  id: "10000000-0000-4000-8000-000000000003",
  slug: "family",
  name: "Family Club",
  description: "Two loaves each Sunday.",
  priceCents: 9600,
  loavesPerWeek: 2,
  active: true,
  sortOrder: 30,
  stripeProductId: "prod_family",
  stripePriceId: "price_family",
  stripePriceCents: 9600,
  stripeLookupKey: "bread_club_family_4week_v1",
  eligibleProducts: [
    {
      id: "20000000-0000-4000-8000-000000000001",
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
    {
      id: "20000000-0000-4000-8000-000000000002",
      name: "Rosemary Garlic Loaf",
      description: "A savory loaf.",
      imageUrl: null,
      imageStyle: "from-stone-100 to-emerald-100",
      ingredients: ["Flour", "Water", "Salt", "Rosemary"],
      allergens: ["Wheat"],
      priceCents: 1400,
      guaranteed: false,
      estimatedIngredientCostCents: 400,
    },
  ],
};

describe("Bread Club pricing and capacity", () => {
  it("builds the exact four-week authorization in bakery time", () => {
    expect(
      buildBreadClubConsentText(
        8000,
        false,
        new Date("2026-07-27T02:00:00.000Z"),
      ),
    ).toBe(
      "I authorize $80.00 to be charged today, July 26, 2026, and every four weeks until I cancel through my membership page or by emailing orders@landlsourdough.com. No additional tax is currently added; any future tax change will be disclosed before it applies.",
    );
  });

  it("calculates every published delivered total exactly", () => {
    expect(getBreadClubDeliveredTotals(4400)).toEqual([6400, 7200, 8400]);
    expect(getBreadClubDeliveredTotals(5200)).toEqual([7200, 8000, 9200]);
    expect(getBreadClubDeliveredTotals(9600)).toEqual([
      11600, 12400, 13600,
    ]);
    expect(getBreadClubCycleTotalCents(5200, 2800, 312)).toBe(8312);
  });

  it("maps route boundaries to the matching four-week delivery band", () => {
    expect(getBreadClubDeliveryBandKey(10, 500)).toBe("0-10");
    expect(getBreadClubDeliveryBandKey(11, 700)).toBe("11-20");
    expect(getBreadClubDeliveryBandKey(20, 700)).toBe("11-20");
    expect(getBreadClubDeliveryBandKey(21, 1000)).toBe("21-30");
    expect(getBreadClubDeliveryBandKey(30, 1000)).toBe("21-30");
  });

  it("enforces the ten-loaf commitment and Family's two slots", () => {
    expect(canReserveBreadClubLoafSlots(8, 2, 10)).toBe(true);
    expect(canReserveBreadClubLoafSlots(9, 2, 10)).toBe(false);
    expect(canReserveBreadClubLoafSlots(10, 1, 10)).toBe(false);
  });

  it("grandfathers renewal Prices until Grace schedules a change", () => {
    expect(
      getBreadClubRenewalPricing({
        currentPlanPriceCents: 5600,
        currentDeliveryPriceCents: 3200,
        previousPlanPriceCents: 5200,
        previousDeliveryPriceCents: 2800,
        applyCurrentPlanPrice: false,
        applyCurrentDeliveryPrice: false,
      }),
    ).toEqual({
      planPriceCents: 5200,
      deliveryPriceCents: 2800,
      totalCents: 8000,
    });

    expect(
      getBreadClubRenewalPricing({
        currentPlanPriceCents: 9600,
        currentDeliveryPriceCents: 4000,
        previousPlanPriceCents: 5200,
        previousDeliveryPriceCents: 2800,
        applyCurrentPlanPrice: true,
        applyCurrentDeliveryPrice: true,
      }),
    ).toEqual({
      planPriceCents: 9600,
      deliveryPriceCents: 4000,
      totalCents: 13600,
    });
  });

  it("normalizes duplicate selections and estimates contribution", () => {
    const selection = normalizeBreadClubSelection([
      { productId: plan.eligibleProducts[0].id, quantity: 1 },
      { productId: plan.eligibleProducts[0].id, quantity: 1 },
    ]);
    expect(selection).toEqual([
      { productId: plan.eligibleProducts[0].id, quantity: 2 },
    ]);
    expect(validateBreadClubSelection(plan, selection)).toBeNull();
    expect(
      validateBreadClubSelection(plan, [
        { productId: plan.eligibleProducts[0].id, quantity: 1 },
      ]),
    ).toContain("requires 2 loaves");
    expect(estimatePlanContributionCents(plan, selection)).toEqual({
      ingredientCostCents: 2400,
      stripeFeeCents: 376,
      contributionCents: 6824,
    });
  });
});
