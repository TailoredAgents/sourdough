import { describe, expect, it } from "vitest";
import { buildOrderSummary } from "./order-records";
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

describe("order records", () => {
  it("builds a readable order summary", () => {
    expect(buildOrderSummary([{ ...product, quantity: 2 }])).toBe(
      "2 x Classic Country Loaf",
    );
  });
});
