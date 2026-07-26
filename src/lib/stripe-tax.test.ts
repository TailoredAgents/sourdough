import type Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createStripeDeliveryCustomer,
  getCatalogProductTaxCode,
  isStripeAutomaticTaxEnabled,
  STRIPE_TAX_CODES,
  toStripeAddress,
} from "./stripe-tax";

const deliveryAddress = {
  line1: "123 Main Street",
  line2: "Suite 2",
  city: "Woodstock",
  state: "Georgia",
  postalCode: "30188",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Stripe tax configuration", () => {
  it("maps bakery products to explicit off-premises food tax codes", () => {
    expect(
      getCatalogProductTaxCode({
        slug: "classic-country",
        name: "Classic Country Loaf",
        category: "bread",
      }),
    ).toBe(STRIPE_TAX_CODES.plainBread);
    expect(
      getCatalogProductTaxCode({
        slug: "rosemary-garlic",
        name: "Rosemary Garlic Loaf",
        category: "bread",
      }),
    ).toBe(STRIPE_TAX_CODES.specialtyBread);
    expect(
      getCatalogProductTaxCode({
        slug: "honey-butter",
        name: "Whipped Honey Butter",
        category: "add-on",
      }),
    ).toBe(STRIPE_TAX_CODES.foodForNonImmediateConsumption);
  });

  it("uses the bakery-wide tax flag with the legacy Bread Club fallback", () => {
    vi.stubEnv("STRIPE_AUTOMATIC_TAX_ENABLED", "true");
    vi.stubEnv("BREAD_CLUB_AUTOMATIC_TAX_ENABLED", "false");
    expect(isStripeAutomaticTaxEnabled()).toBe(true);

    vi.stubEnv("STRIPE_AUTOMATIC_TAX_ENABLED", undefined);
    vi.stubEnv("BREAD_CLUB_AUTOMATIC_TAX_ENABLED", "true");
    expect(isStripeAutomaticTaxEnabled()).toBe(true);
  });

  it("creates a Stripe customer with the verified delivery destination", async () => {
    const create = vi.fn().mockResolvedValue({ id: "cus_tax" });
    const stripe = {
      customers: { create },
    } as unknown as Stripe;

    await createStripeDeliveryCustomer(stripe, {
      name: "Customer Name",
      email: "CUSTOMER@EXAMPLE.COM",
      phone: "4045550100",
      address: deliveryAddress,
      metadata: { storefront_order_id: "order-id" },
    });

    const address = toStripeAddress(deliveryAddress);
    expect(address).toEqual({
      line1: "123 Main Street",
      line2: "Suite 2",
      city: "Woodstock",
      state: "GA",
      postal_code: "30188",
      country: "US",
    });
    expect(create).toHaveBeenCalledWith({
      name: "Customer Name",
      email: "customer@example.com",
      phone: "4045550100",
      address,
      shipping: {
        name: "Customer Name",
        phone: "4045550100",
        address,
      },
      tax: { validate_location: "immediately" },
      metadata: { storefront_order_id: "order-id" },
    });
  });
});
