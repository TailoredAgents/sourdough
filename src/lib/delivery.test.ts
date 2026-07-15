import { describe, expect, it } from "vitest";
import {
  checkDeliveryAddress,
  normalizePostalCode,
  type DeliverySettings,
} from "./delivery";

const settings: DeliverySettings = {
  radiusMiles: 12,
  deliveryFeeCents: 600,
  allowedPostalCodes: ["30114", "30115"],
  serviceAreaCopy: "Delivery is available in selected local ZIP codes.",
  center: { lat: 34.2368, lng: -84.4908 },
};

describe("delivery ZIP allowlist", () => {
  it("accepts Georgia addresses in the allowlist", () => {
    const result = checkDeliveryAddress(
      {
        line1: "1 Main St",
        city: "Canton",
        state: "GA",
        postalCode: "30114",
      },
      settings,
    );

    expect(result.eligible).toBe(true);
    expect(result.feeCents).toBe(600);
    expect(result.postalCode).toBe("30114");
  });

  it("rejects Georgia addresses outside the allowlist", () => {
    const result = checkDeliveryAddress(
      {
        line1: "1 Main St",
        city: "Atlanta",
        state: "GA",
        postalCode: "30303",
      },
      settings,
    );

    expect(result.eligible).toBe(false);
    expect(result.message).toContain("outside");
  });

  it("rejects out-of-state addresses", () => {
    const result = checkDeliveryAddress(
      {
        line1: "1 Main St",
        city: "Chattanooga",
        state: "TN",
        postalCode: "37402",
      },
      settings,
    );

    expect(result.eligible).toBe(false);
    expect(result.message).toContain("Georgia");
  });

  it("requires an exact 5-digit ZIP code", () => {
    expect(normalizePostalCode("30114")).toBe("30114");
    expect(normalizePostalCode("abc30114xyz")).toBeNull();
    expect(normalizePostalCode("30114-1234")).toBeNull();
  });
});
