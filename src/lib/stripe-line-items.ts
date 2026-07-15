import type Stripe from "stripe";
import type { MenuProduct } from "./types";

type CheckoutProductItem = MenuProduct & {
  quantity: number;
};

export function buildCatalogLineItem(
  item: CheckoutProductItem,
): Stripe.Checkout.SessionCreateParams.LineItem {
  const stripePriceId = item.stripePriceId;
  const hasCurrentStripePrice =
    Boolean(stripePriceId) && item.stripePriceCents === item.priceCents;

  if (stripePriceId && hasCurrentStripePrice) {
    return {
      price: stripePriceId,
      quantity: item.quantity,
    };
  }

  return {
    quantity: item.quantity,
    price_data: {
      currency: "usd",
      unit_amount: item.priceCents,
      product_data: {
        name: item.name,
        description: item.description,
        metadata: {
          product_id: item.id,
        },
      },
    },
  };
}

export function buildDeliveryLineItem(
  feeCents: number,
): Stripe.Checkout.SessionCreateParams.LineItem {
  return {
    quantity: 1,
    price_data: {
      currency: "usd",
      unit_amount: feeCents,
      product_data: {
        name: "Local delivery",
        description: "ZIP-based local delivery around Canton and Woodstock, GA",
      },
    },
  };
}
