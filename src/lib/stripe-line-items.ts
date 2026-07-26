import type Stripe from "stripe";
import {
  getCatalogProductTaxCode,
  STRIPE_TAX_CODES,
} from "./stripe-tax";
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
      tax_behavior: "exclusive",
      product_data: {
        name: item.name,
        description: item.description,
        tax_code: getCatalogProductTaxCode(item),
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
      tax_behavior: "exclusive",
      product_data: {
        name: "Local delivery",
        description: "Drive-time based Sunday local delivery around Canton and Woodstock, GA",
        tax_code: STRIPE_TAX_CODES.shipping,
      },
    },
  };
}
