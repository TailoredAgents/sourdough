import { describe, expect, it } from "vitest";
import {
  getAdminProductStripeStatus,
  getAdminProductWarnings,
  summarizeAdminProducts,
} from "./admin-product-status";
import type { Product } from "./types";

const product: Product = {
  id: "product-1",
  name: "Classic Country Loaf",
  category: "bread",
  description: "A naturally leavened loaf.",
  ingredients: ["Flour", "Water", "Salt"],
  allergens: ["Wheat"],
  priceCents: 1200,
  stripeProductId: "prod_123",
  stripePriceId: "price_123",
  stripePriceCents: 1200,
  stripeSyncedAt: "2026-07-15T12:00:00.000Z",
  imageUrl: "/images/products/classic-country-loaf.webp",
  imageStyle: "from-stone-100 via-amber-100 to-orange-200",
  active: true,
};

describe("admin product status", () => {
  it("labels Stripe readiness for active products", () => {
    expect(getAdminProductStripeStatus(product)).toEqual({
      label: "Stripe ready",
      tone: "ready",
    });

    expect(
      getAdminProductStripeStatus({
        ...product,
        stripePriceCents: 1000,
      }),
    ).toEqual({
      label: "Stripe price stale",
      tone: "warning",
    });

    expect(
      getAdminProductStripeStatus({
        ...product,
        stripePriceId: null,
      }),
    ).toEqual({
      label: "Needs Stripe sync",
      tone: "warning",
    });
  });

  it("does not require Stripe price readiness for hidden products", () => {
    expect(
      getAdminProductStripeStatus({
        ...product,
        active: false,
        stripePriceId: null,
      }),
    ).toEqual({
      label: "Stripe optional",
      tone: "muted",
    });
  });

  it("summarizes warnings that matter before publishing a product", () => {
    expect(
      getAdminProductWarnings(
        {
          ...product,
          active: false,
          imageUrl: null,
        },
        true,
      ),
    ).toEqual([
      "This product is hidden but still appears in this week's menu.",
      "Add a real product photo before featuring this item.",
    ]);

    expect(
      getAdminProductWarnings(
        {
          ...product,
          stripePriceId: null,
        },
        true,
      ),
    ).toEqual(["Run Stripe catalog sync before relying on checkout for this item."]);
  });

  it("counts active, menu, Stripe, and photo status for the dashboard", () => {
    expect(
      summarizeAdminProducts(
        [
          product,
          {
            ...product,
            id: "product-2",
            active: true,
            stripePriceId: null,
            imageUrl: null,
          },
          {
            ...product,
            id: "product-3",
            active: false,
            stripePriceId: null,
          },
        ],
        new Set(["product-1", "product-2"]),
      ),
    ).toEqual({
      active: 2,
      inCurrentMenu: 2,
      needsStripeSync: 1,
      missingPhotos: 1,
    });
  });
});
