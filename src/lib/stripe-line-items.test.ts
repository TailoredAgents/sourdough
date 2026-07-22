import { describe, expect, it } from "vitest";
import { buildCatalogLineItem, buildDeliveryLineItem } from "./stripe-line-items";
import type { MenuProduct } from "./types";

const product: MenuProduct = {
  id: "product-1",
  productId: "product-1",
  name: "Classic Country Loaf",
  category: "bread",
  description: "A loaf",
  ingredients: ["flour"],
  allergens: ["Wheat"],
  priceCents: 1200,
  imageUrl: null,
  imageStyle: "from-stone-100 to-amber-100",
  active: true,
  availableQuantity: 10,
  soldQuantity: 0,
  remainingQuantity: 10,
};

describe("stripe line items", () => {
  it("uses the saved Stripe price when it matches the current product price", () => {
    expect(
      buildCatalogLineItem({
        ...product,
        stripePriceId: "price_123",
        stripePriceCents: 1200,
        quantity: 2,
      }),
    ).toEqual({
      price: "price_123",
      quantity: 2,
    });
  });

  it("falls back to inline price data when the saved Stripe price is stale", () => {
    expect(
      buildCatalogLineItem({
        ...product,
        stripePriceId: "price_123",
        stripePriceCents: 1000,
        quantity: 1,
      }),
    ).toMatchObject({
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: 1200,
        product_data: {
          name: "Classic Country Loaf",
        },
      },
    });
  });

  it("charges delivery as a separate line item at the checked delivery fee", () => {
    expect(buildDeliveryLineItem(600)).toEqual({
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: 600,
        product_data: {
          name: "Local delivery",
          description: "Drive-time based Sunday local delivery around Canton and Woodstock, GA",
        },
      },
    });
  });
});
