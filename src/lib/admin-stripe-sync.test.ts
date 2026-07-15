import { describe, expect, it } from "vitest";
import {
  extractStripeCatalogSyncItems,
  summarizeStripeCatalogSync,
} from "./admin-stripe-sync";

describe("admin Stripe sync helpers", () => {
  it("summarizes product and price creation clearly", () => {
    expect(
      summarizeStripeCatalogSync([
        {
          productId: "product-1",
          name: "Classic Country Loaf",
          active: true,
          priceCents: 1200,
          stripeProductId: "prod_123",
          stripePriceId: "price_123",
          createdProduct: true,
          createdPrice: true,
        },
        {
          productId: "product-2",
          name: "Hidden Loaf",
          active: false,
          priceCents: 1500,
          stripeProductId: "prod_456",
          stripePriceId: null,
          createdProduct: false,
          createdPrice: false,
        },
      ]),
    ).toEqual({
      activeProductCount: 1,
      createdProductCount: 1,
      createdPriceCount: 1,
      message: "Stripe synced 2 products (1 active, 1 new products, 1 new prices).",
    });
  });

  it("extracts only well-formed sync items from API payloads", () => {
    const products = extractStripeCatalogSyncItems({
      products: [
        {
          productId: "product-1",
          name: "Classic Country Loaf",
          active: true,
          priceCents: 1200,
          stripeProductId: "prod_123",
          stripePriceId: "price_123",
          createdProduct: false,
          createdPrice: true,
        },
        {
          productId: "broken",
          name: "Broken",
        },
      ],
    });

    expect(products).toHaveLength(1);
    expect(products?.[0]?.name).toBe("Classic Country Loaf");
    expect(extractStripeCatalogSyncItems({ error: "No products" })).toBeNull();
  });
});
