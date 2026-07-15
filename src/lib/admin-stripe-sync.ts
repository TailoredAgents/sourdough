import type { StripeCatalogSyncItem } from "./stripe-catalog";

export function summarizeStripeCatalogSync(items: StripeCatalogSyncItem[]) {
  const createdProductCount = items.filter((item) => item.createdProduct).length;
  const createdPriceCount = items.filter((item) => item.createdPrice).length;
  const activeProductCount = items.filter((item) => item.active).length;

  return {
    activeProductCount,
    createdPriceCount,
    createdProductCount,
    message:
      items.length === 0
        ? "No products found to sync."
        : `Stripe synced ${items.length} products (${activeProductCount} active, ${createdProductCount} new products, ${createdPriceCount} new prices).`,
  };
}

export function extractStripeCatalogSyncItems(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const products = (payload as { products?: unknown }).products;
  if (!Array.isArray(products)) return null;

  return products.filter((product): product is StripeCatalogSyncItem => {
    if (!product || typeof product !== "object") return false;
    const item = product as Partial<StripeCatalogSyncItem>;
    return (
      typeof item.productId === "string" &&
      typeof item.name === "string" &&
      typeof item.active === "boolean" &&
      typeof item.priceCents === "number" &&
      typeof item.stripeProductId === "string" &&
      typeof item.createdProduct === "boolean" &&
      typeof item.createdPrice === "boolean" &&
      (typeof item.stripePriceId === "string" || item.stripePriceId === null)
    );
  });
}
