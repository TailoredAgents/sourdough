import { describe, expect, it } from "vitest";
import {
  checkoutSchema,
  getCheckoutDeliveryError,
  getCheckoutRateLimitKey,
  getDeliveryWindowAvailabilityError,
  getLastMinuteNotificationDeliveryWindow,
  getMissingStripeCheckoutError,
  POST,
} from "./route";
import type { DeliveryCheckResult } from "@/lib/delivery";

const baseDeliveryCheck: DeliveryCheckResult = {
  eligible: true,
  needsReview: false,
  miles: null,
  message: "30114 is in our local delivery area.",
  feeCents: 600,
  postalCode: "30114",
  allowedPostalCodes: ["30114", "30115"],
};

const baseCheckoutPayload = {
  cart: [{ productId: "classic-country-loaf", quantity: 1 }],
  customer: {
    name: "Test Customer",
    email: "customer@example.com",
    phone: "4045550100",
  },
  address: {
    line1: "123 Main Street",
    line2: "",
    city: "Canton",
    state: "GA",
    postalCode: "30114",
  },
  deliveryWindowId: "friday-evening",
  deliveryInstructions: "",
  notes: "",
  acknowledgedTerms: true,
};

describe("checkout delivery eligibility", () => {
  it("allows eligible delivery checks", () => {
    expect(getCheckoutDeliveryError(baseDeliveryCheck)).toBeNull();
  });

  it("rejects ineligible delivery checks regardless of cutoff mode", () => {
    expect(
      getCheckoutDeliveryError({
        ...baseDeliveryCheck,
        eligible: false,
        message: "30303 is outside our current delivery area.",
        postalCode: "30303",
      }),
    ).toContain("outside");
  });

  it("requires customer acknowledgement of ingredients, allergens, and order terms", () => {
    expect(checkoutSchema.safeParse(baseCheckoutPayload).success).toBe(true);
    expect(
      checkoutSchema.safeParse({
        ...baseCheckoutPayload,
        acknowledgedTerms: false,
      }).success,
    ).toBe(false);
    const withoutAcknowledgement: Partial<typeof baseCheckoutPayload> = {
      ...baseCheckoutPayload,
    };
    delete withoutAcknowledgement.acknowledgedTerms;
    expect(checkoutSchema.safeParse(withoutAcknowledgement).success).toBe(false);
  });

  it("matches storefront validation for phone and ZIP fields", () => {
    expect(
      checkoutSchema.safeParse({
        ...baseCheckoutPayload,
        customer: { ...baseCheckoutPayload.customer, phone: "abcdefg" },
      }).success,
    ).toBe(false);
    expect(
      checkoutSchema.safeParse({
        ...baseCheckoutPayload,
        customer: { ...baseCheckoutPayload.customer, phone: "(404) 555-0100" },
      }).success,
    ).toBe(true);
    expect(
      checkoutSchema.safeParse({
        ...baseCheckoutPayload,
        address: { ...baseCheckoutPayload.address, postalCode: "301" },
      }).success,
    ).toBe(false);
    expect(
      checkoutSchema.safeParse({
        ...baseCheckoutPayload,
        address: { ...baseCheckoutPayload.address, postalCode: "30114-1234" },
      }).success,
    ).toBe(false);
  });

  it("rejects full delivery windows before checkout starts", () => {
    expect(
      getDeliveryWindowAvailabilityError({ capacity: 10, reserved: 9 }),
    ).toBeNull();
    expect(
      getDeliveryWindowAvailabilityError({ capacity: 10, reserved: 10 }),
    ).toContain("delivery window is full");
  });

  it("uses the selected delivery window in last-minute owner notifications", () => {
    expect(
      getLastMinuteNotificationDeliveryWindow({
        label: "Friday, 2:00-5:00 PM",
      }),
    ).toBe("Friday, 2:00-5:00 PM");
  });

  it("allows missing Stripe demo checkout only outside production", () => {
    expect(getMissingStripeCheckoutError("development")).toBeNull();
    expect(getMissingStripeCheckoutError("test")).toBeNull();
    expect(getMissingStripeCheckoutError("production")).toContain(
      "checkout is temporarily unavailable",
    );
  });

  it("keys checkout rate limits by forwarded IP and normalized email", () => {
    const request = new Request("https://landlsourdough.com/api/checkout", {
      headers: {
        "x-forwarded-for": "203.0.113.10, 198.51.100.2",
      },
    });

    expect(getCheckoutRateLimitKey(request, "Customer@Example.COM")).toBe(
      "203.0.113.10:customer@example.com",
    );
  });

  it("returns a controlled form error for malformed checkout JSON", async () => {
    const response = await POST(
      new Request("https://landlsourdough.com/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Please complete the order form before checkout.",
    });
  });
});
