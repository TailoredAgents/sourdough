import type Stripe from "stripe";
import { productSlug } from "./product-slugs";
import type { DeliveryAddress, ProductCategory } from "./types";

export const STRIPE_TAX_CODES = {
  foodForNonImmediateConsumption: "txcd_40040000",
  plainBread: "txcd_40040021",
  specialtyBread: "txcd_40040022",
  shipping: "txcd_92010001",
} as const;

const PLAIN_BREAD_SLUGS = new Set([
  "classic-country",
  "classic-country-loaf",
  "sourdough-loaf",
]);

const SPECIALTY_BREAD_SLUGS = new Set([
  "cinnamon-swirl",
  "cinnamon-swirl-sourdough",
  "rosemary-garlic",
  "rosemary-garlic-loaf",
]);

type TaxableCatalogProduct = {
  slug?: string;
  name: string;
  category: ProductCategory | string;
};

export function getCatalogProductTaxCode(product: TaxableCatalogProduct) {
  const slug = product.slug || productSlug(product);
  if (PLAIN_BREAD_SLUGS.has(slug)) return STRIPE_TAX_CODES.plainBread;
  if (SPECIALTY_BREAD_SLUGS.has(slug)) {
    return STRIPE_TAX_CODES.specialtyBread;
  }
  return STRIPE_TAX_CODES.foodForNonImmediateConsumption;
}

export function isStripeAutomaticTaxEnabled() {
  const configured =
    process.env.STRIPE_AUTOMATIC_TAX_ENABLED ??
    process.env.BREAD_CLUB_AUTOMATIC_TAX_ENABLED;
  return configured?.trim().toLowerCase() === "true";
}

export function toStripeAddress(
  address: DeliveryAddress,
) {
  const normalizedState = address.state.trim().toUpperCase();
  return {
    line1: address.line1.trim(),
    line2: address.line2?.trim() || undefined,
    city: address.city.trim(),
    state: normalizedState === "GEORGIA" ? "GA" : normalizedState,
    postal_code: address.postalCode.trim(),
    country: "US",
  } satisfies Stripe.AddressParam;
}

type StripeDeliveryCustomer = {
  name: string;
  email: string;
  phone: string;
  address: DeliveryAddress;
  metadata: Record<string, string>;
};

export async function createStripeDeliveryCustomer(
  stripe: Stripe,
  input: StripeDeliveryCustomer,
) {
  const address = toStripeAddress(input.address);
  return stripe.customers.create({
    name: input.name,
    email: input.email.trim().toLowerCase(),
    phone: input.phone,
    address,
    shipping: {
      name: input.name,
      phone: input.phone,
      address,
    },
    tax: {
      validate_location: "immediately",
    },
    metadata: input.metadata,
  });
}

export async function updateStripeDeliveryCustomer(
  stripe: Stripe,
  customerId: string,
  input: Omit<StripeDeliveryCustomer, "email" | "metadata">,
) {
  const address = toStripeAddress(input.address);
  return stripe.customers.update(customerId, {
    name: input.name,
    phone: input.phone,
    address,
    shipping: {
      name: input.name,
      phone: input.phone,
      address,
    },
    tax: {
      validate_location: "immediately",
    },
  });
}
