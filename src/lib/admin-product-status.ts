import type { Product } from "./types";

export type AdminProductStripeStatus = {
  label: string;
  tone: "ready" | "warning" | "muted";
};

export function getAdminProductStripeStatus(product: Product): AdminProductStripeStatus {
  if (!product.active) {
    return {
      label: "Stripe optional",
      tone: "muted",
    };
  }

  if (product.stripePriceId && product.stripePriceCents === product.priceCents) {
    return {
      label: "Stripe ready",
      tone: "ready",
    };
  }

  if (product.stripePriceId && product.stripePriceCents !== product.priceCents) {
    return {
      label: "Stripe price stale",
      tone: "warning",
    };
  }

  return {
    label: "Needs Stripe sync",
    tone: "warning",
  };
}

export function getAdminProductWarnings(product: Product, isInCurrentMenu: boolean) {
  const warnings: string[] = [];
  const stripeStatus = getAdminProductStripeStatus(product);

  if (!product.active && isInCurrentMenu) {
    warnings.push("This product is hidden but still appears in this week's menu.");
  }

  if (product.active && isInCurrentMenu && stripeStatus.tone === "warning") {
    warnings.push("Run Stripe catalog sync before relying on checkout for this item.");
  }

  if (!product.imageUrl) {
    warnings.push("Add a real product photo before featuring this item.");
  }

  return warnings;
}

export function summarizeAdminProducts(
  products: Product[],
  currentMenuProductIds: Set<string>,
) {
  return products.reduce(
    (summary, product) => {
      const isInCurrentMenu = currentMenuProductIds.has(product.id);
      const stripeStatus = getAdminProductStripeStatus(product);

      return {
        active: summary.active + (product.active ? 1 : 0),
        inCurrentMenu: summary.inCurrentMenu + (isInCurrentMenu ? 1 : 0),
        needsStripeSync:
          summary.needsStripeSync + (stripeStatus.tone === "warning" ? 1 : 0),
        missingPhotos: summary.missingPhotos + (product.imageUrl ? 0 : 1),
      };
    },
    {
      active: 0,
      inCurrentMenu: 0,
      needsStripeSync: 0,
      missingPhotos: 0,
    },
  );
}
