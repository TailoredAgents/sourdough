import { describe, expect, it } from "vitest";
import type { MenuProduct, OrderingWeek } from "@/lib/types";
import type { BreadClubPlan, BreadClubPlanProduct } from "./types";
import {
  getBreadClubEnrollmentWeeks,
  getDefaultBreadClubSelection,
  getProductsAvailableForAllWeeks,
  isBreadClubProductAvailableForAllWeeks,
} from "./schedule";

const product: MenuProduct = {
  id: "20000000-0000-4000-8000-000000000001",
  productId: "20000000-0000-4000-8000-000000000001",
  name: "Classic Country Loaf",
  category: "bread",
  description: "A dependable loaf.",
  ingredients: ["Flour", "Water", "Salt"],
  allergens: ["Wheat"],
  priceCents: 1200,
  imageUrl: null,
  imageStyle: "from-stone-100 to-amber-100",
  active: true,
  availableQuantity: 20,
  soldQuantity: 0,
  remainingQuantity: 20,
};

function week(
  index: number,
  cutoffAt: string,
  deliveryStartsAt: string,
  deliveryEndsAt: string,
  reserved = 0,
): OrderingWeek {
  const menuId = `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  return {
    weeklyMenu: {
      id: menuId,
      name: `Sunday ${index}`,
      orderCutoffAt: cutoffAt,
      startsAt: cutoffAt,
      endsAt: deliveryEndsAt,
      published: true,
      items: [product],
    },
    menu: [product],
    deliveryWindows: [
      {
        id: `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        weeklyMenuId: menuId,
        label: `Sunday delivery ${index}`,
        startsAt: deliveryStartsAt,
        endsAt: deliveryEndsAt,
        capacity: 20,
        reserved,
      },
    ],
  };
}

function planProduct(
  item: MenuProduct,
  guaranteed = false,
): BreadClubPlanProduct {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    imageUrl: item.imageUrl,
    imageStyle: item.imageStyle,
    ingredients: item.ingredients,
    allergens: item.allergens,
    priceCents: item.priceCents,
    guaranteed,
    estimatedIngredientCostCents: null,
  };
}

describe("Bread Club Sunday selection", () => {
  it("starts with the upcoming Sunday before Thursday cutoff", () => {
    const weeks = [
      week(
        1,
        "2026-07-24T04:00:00.000Z",
        "2026-07-26T19:00:00.000Z",
        "2026-07-26T22:00:00.000Z",
      ),
      week(
        2,
        "2026-07-31T04:00:00.000Z",
        "2026-08-02T19:00:00.000Z",
        "2026-08-02T22:00:00.000Z",
      ),
      week(
        3,
        "2026-08-07T04:00:00.000Z",
        "2026-08-09T19:00:00.000Z",
        "2026-08-09T22:00:00.000Z",
      ),
      week(
        4,
        "2026-08-14T04:00:00.000Z",
        "2026-08-16T19:00:00.000Z",
        "2026-08-16T22:00:00.000Z",
      ),
    ];
    expect(
      getBreadClubEnrollmentWeeks(
        weeks,
        new Date("2026-07-23T20:00:00.000Z"),
      ).map((item) => item.weeklyMenu.id),
    ).toEqual(weeks.map((item) => item.weeklyMenu.id));
  });

  it("never puts a subscription into same-week request mode after cutoff", () => {
    const weeks = [
      week(
        1,
        "2026-07-24T04:00:00.000Z",
        "2026-07-26T19:00:00.000Z",
        "2026-07-26T22:00:00.000Z",
      ),
      week(
        2,
        "2026-07-31T04:00:00.000Z",
        "2026-08-02T19:00:00.000Z",
        "2026-08-02T22:00:00.000Z",
      ),
      week(
        3,
        "2026-08-07T04:00:00.000Z",
        "2026-08-09T19:00:00.000Z",
        "2026-08-09T22:00:00.000Z",
      ),
      week(
        4,
        "2026-08-14T04:00:00.000Z",
        "2026-08-16T19:00:00.000Z",
        "2026-08-16T22:00:00.000Z",
      ),
      week(
        5,
        "2026-08-21T04:00:00.000Z",
        "2026-08-23T19:00:00.000Z",
        "2026-08-23T22:00:00.000Z",
      ),
    ];
    const selected = getBreadClubEnrollmentWeeks(
      weeks,
      new Date("2026-07-24T14:00:00.000Z"),
    );
    expect(selected).toHaveLength(4);
    expect(selected[0].weeklyMenu.id).toBe(weeks[1].weeklyMenu.id);
    expect(selected.some((item) => item.weeklyMenu.id === weeks[0].weeklyMenu.id)).toBe(
      false,
    );
  });

  it("excludes a full Sunday stop before taking the first four", () => {
    const weeks = [
      week(
        1,
        "2026-07-31T04:00:00.000Z",
        "2026-08-02T19:00:00.000Z",
        "2026-08-02T22:00:00.000Z",
        20,
      ),
      week(
        2,
        "2026-08-07T04:00:00.000Z",
        "2026-08-09T19:00:00.000Z",
        "2026-08-09T22:00:00.000Z",
      ),
    ];
    expect(
      getBreadClubEnrollmentWeeks(
        weeks,
        new Date("2026-07-27T12:00:00.000Z"),
      ).map((item) => item.weeklyMenu.id),
    ).toEqual([weeks[1].weeklyMenu.id]);
  });

  it("offers only products that are reservable on every Sunday", () => {
    const alwaysAvailable: MenuProduct = {
      ...product,
      id: "20000000-0000-4000-8000-000000000002",
      productId: "20000000-0000-4000-8000-000000000002",
      name: "Rosemary Garlic Loaf",
    };
    const absentProduct: MenuProduct = {
      ...product,
      id: "20000000-0000-4000-8000-000000000003",
      productId: "20000000-0000-4000-8000-000000000003",
      name: "Sourdough Loaf",
    };
    const orderingWeeks = Array.from({ length: 4 }, (_, index) => {
      const item = week(
        index + 1,
        `2099-0${index + 1}-01T04:00:00.000Z`,
        `2099-0${index + 1}-03T19:00:00.000Z`,
        `2099-0${index + 1}-03T22:00:00.000Z`,
      );
      item.menu = [product, alwaysAvailable];
      item.weeklyMenu.items = item.menu;
      return item;
    });
    const enrollmentWeeks = getBreadClubEnrollmentWeeks(
      orderingWeeks,
      new Date("2098-12-01T12:00:00.000Z"),
    );
    const plan = {
      id: "10000000-0000-4000-8000-000000000002",
      slug: "variety",
      name: "Variety Club",
      description: "One loaf each Sunday.",
      priceCents: 5200,
      loavesPerWeek: 1,
      active: true,
      sortOrder: 20,
      stripeProductId: null,
      stripePriceId: null,
      stripePriceCents: null,
      stripeLookupKey: "bread_club_variety_4week_v1",
      eligibleProducts: [
        planProduct(absentProduct),
        planProduct(alwaysAvailable),
        planProduct(product, true),
      ],
    } satisfies BreadClubPlan;

    expect(
      getProductsAvailableForAllWeeks(plan, enrollmentWeeks).map(
        (item) => item.name,
      ),
    ).toEqual(["Rosemary Garlic Loaf", "Classic Country Loaf"]);
    expect(
      isBreadClubProductAvailableForAllWeeks(
        absentProduct.id,
        enrollmentWeeks,
      ),
    ).toBe(false);
    expect(getDefaultBreadClubSelection(plan, enrollmentWeeks)).toEqual([
      { productId: product.id, quantity: 1 },
    ]);
  });

  it("builds a valid two-loaf default when inventory must be split", () => {
    const oneRemaining: MenuProduct = {
      ...product,
      availableQuantity: 1,
      remainingQuantity: 1,
    };
    const secondProduct: MenuProduct = {
      ...oneRemaining,
      id: "20000000-0000-4000-8000-000000000004",
      productId: "20000000-0000-4000-8000-000000000004",
      name: "Cinnamon Swirl Sourdough",
    };
    const orderingWeeks = Array.from({ length: 4 }, (_, index) => {
      const item = week(
        index + 1,
        `2099-0${index + 1}-01T04:00:00.000Z`,
        `2099-0${index + 1}-03T19:00:00.000Z`,
        `2099-0${index + 1}-03T22:00:00.000Z`,
      );
      item.menu = [oneRemaining, secondProduct];
      item.weeklyMenu.items = item.menu;
      return item;
    });
    const enrollmentWeeks = getBreadClubEnrollmentWeeks(
      orderingWeeks,
      new Date("2098-12-01T12:00:00.000Z"),
    );
    const familyPlan = {
      id: "10000000-0000-4000-8000-000000000003",
      slug: "family",
      name: "Family Club",
      description: "Two loaves each Sunday.",
      priceCents: 9600,
      loavesPerWeek: 2,
      active: true,
      sortOrder: 30,
      stripeProductId: null,
      stripePriceId: null,
      stripePriceCents: null,
      stripeLookupKey: "bread_club_family_4week_v1",
      eligibleProducts: [
        planProduct(oneRemaining, true),
        planProduct(secondProduct),
      ],
    } satisfies BreadClubPlan;

    expect(getDefaultBreadClubSelection(familyPlan, enrollmentWeeks)).toEqual([
      { productId: oneRemaining.id, quantity: 1 },
      { productId: secondProduct.id, quantity: 1 },
    ]);
  });
});
