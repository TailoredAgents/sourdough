import { describe, expect, it } from "vitest";
import { absoluteImageUrl, absoluteUrl } from "./url";

describe("URL helpers", () => {
  it("turns app-relative paths into absolute URLs", () => {
    expect(absoluteUrl("/images/products/classic-country-loaf.webp")).toBe(
      "https://landlsourdough.com/images/products/classic-country-loaf.webp",
    );
  });

  it("preserves absolute Supabase product image URLs", () => {
    expect(
      absoluteImageUrl(
        "https://example.supabase.co/storage/v1/object/public/product-images/classic/image.webp",
      ),
    ).toBe(
      "https://example.supabase.co/storage/v1/object/public/product-images/classic/image.webp",
    );
  });

  it("uses the configured fallback image when no image is present", () => {
    expect(absoluteImageUrl(null, "/images/sourdough-hero.jpg")).toBe(
      "https://landlsourdough.com/images/sourdough-hero.jpg",
    );
  });
});
