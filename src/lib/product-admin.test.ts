import { describe, expect, it } from "vitest";
import { isSupportedProductImageUrl, productAdminSchema } from "./product-admin";

const validProduct = {
  name: "Classic Country Loaf",
  category: "bread",
  description: "A naturally leavened loaf for weekly local delivery.",
  ingredients: ["Flour", "Water", "Salt"],
  allergens: ["Wheat"],
  priceCents: 1200,
  imageStyle: "from-stone-100 via-amber-100 to-orange-200",
  active: true,
};

describe("product admin validation", () => {
  it("accepts app product image paths used by seeded storefront products", () => {
    expect(
      productAdminSchema.safeParse({
        ...validProduct,
        imageUrl: "/images/products/classic-country-loaf.webp",
      }).success,
    ).toBe(true);
  });

  it("accepts uploaded Supabase product images for the configured project", () => {
    expect(
      isSupportedProductImageUrl(
        "https://example.supabase.co/storage/v1/object/public/product-images/classic/image.webp",
        "https://example.supabase.co",
      ),
    ).toBe(true);
  });

  it("rejects unsupported remote image URLs when Supabase is configured", () => {
    expect(
      isSupportedProductImageUrl(
        "https://cdn.example.com/product.jpg",
        "https://example.supabase.co",
      ),
    ).toBe(false);
  });

  it("rejects remote image URLs when Supabase image hosting is not configured", () => {
    expect(
      isSupportedProductImageUrl(
        "https://example.supabase.co/storage/v1/object/public/product-images/classic/image.webp",
        "",
      ),
    ).toBe(false);
  });

  it("rejects unsafe app-relative image paths", () => {
    expect(
      productAdminSchema.safeParse({
        ...validProduct,
        imageUrl: "/images/products/../secret.webp",
      }).success,
    ).toBe(false);
  });
});
