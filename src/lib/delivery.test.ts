import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkDeliveryAddress,
  checkDeliveryAddressWithRoutes,
  getDeliveryFeeForDriveMinutes,
  normalizePostalCode,
  parseDeliveryFeeBands,
  parseGoogleDurationSeconds,
  type DeliverySettings,
} from "./delivery";

const settings: DeliverySettings = {
  radiusMiles: 12,
  deliveryFeeCents: 600,
  allowedPostalCodes: ["30114", "30115"],
  serviceAreaCopy: "Delivery is available in selected local ZIP codes.",
  center: { lat: 34.2368, lng: -84.4908 },
};

const originalEnv = {
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
  DELIVERY_MAX_DRIVE_MINUTES: process.env.DELIVERY_MAX_DRIVE_MINUTES,
  DELIVERY_FEE_BANDS: process.env.DELIVERY_FEE_BANDS,
  DELIVERY_ORIGIN_ADDRESS: process.env.DELIVERY_ORIGIN_ADDRESS,
};

function mockGoogleRoute(duration: string, distanceMeters = 10000) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({
      routes: [{ duration, distanceMeters }],
    }),
  } as Response);
}

beforeEach(() => {
  process.env.GOOGLE_MAPS_API_KEY = "test-google-key";
  process.env.DELIVERY_MAX_DRIVE_MINUTES = "30";
  process.env.DELIVERY_FEE_BANDS = "0-10:500,11-20:700,21-30:1000";
  process.env.DELIVERY_ORIGIN_ADDRESS =
    "4501 Holly Springs Parkway, Canton, GA 30115";
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env.GOOGLE_MAPS_API_KEY = originalEnv.GOOGLE_MAPS_API_KEY;
  process.env.DELIVERY_MAX_DRIVE_MINUTES =
    originalEnv.DELIVERY_MAX_DRIVE_MINUTES;
  process.env.DELIVERY_FEE_BANDS = originalEnv.DELIVERY_FEE_BANDS;
  process.env.DELIVERY_ORIGIN_ADDRESS = originalEnv.DELIVERY_ORIGIN_ADDRESS;
});

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
    expect(result.preliminary).toBe(true);
    expect(result.provider).toBe("zip");
    expect(result.providerStatus).toBe("missing_address");
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
    expect(result.providerStatus).toBe("over_limit");
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

describe("Google Routes delivery pricing", () => {
  it("parses Google duration strings into rounded seconds", () => {
    expect(parseGoogleDurationSeconds("1234s")).toBe(1234);
    expect(parseGoogleDurationSeconds("1234.2s")).toBe(1235);
    expect(parseGoogleDurationSeconds("bad-value")).toBeNull();
  });

  it("parses delivery fee bands and prices boundary drive times", () => {
    const bands = parseDeliveryFeeBands("0-10:500,11-20:700,21-30:1000");

    expect(bands).toEqual([
      { minMinutes: 0, maxMinutes: 10, feeCents: 500 },
      { minMinutes: 11, maxMinutes: 20, feeCents: 700 },
      { minMinutes: 21, maxMinutes: 30, feeCents: 1000 },
    ]);
    expect(getDeliveryFeeForDriveMinutes(10, bands)?.feeCents).toBe(500);
    expect(getDeliveryFeeForDriveMinutes(20, bands)?.feeCents).toBe(700);
    expect(getDeliveryFeeForDriveMinutes(30, bands)?.feeCents).toBe(1000);
    expect(getDeliveryFeeForDriveMinutes(31, bands)).toBeUndefined();
  });

  it("keeps ZIP-only checks preliminary and avoids Google", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await checkDeliveryAddressWithRoutes(
      {
        line1: "",
        city: "Canton",
        state: "GA",
        postalCode: "30114",
      },
      settings,
    );

    expect(result).toMatchObject({
      eligible: true,
      preliminary: true,
      provider: "zip",
      providerStatus: "missing_address",
      feeCents: 600,
    });
    expect(result.message).toContain("exact drive time and delivery fee");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses Google drive time to calculate a full-address delivery fee", async () => {
    mockGoogleRoute("1234s", 14000);

    const result = await checkDeliveryAddressWithRoutes(
      {
        line1: "123 Main St",
        city: "Canton",
        state: "GA",
        postalCode: "30114",
      },
      settings,
    );

    expect(result).toMatchObject({
      eligible: true,
      preliminary: false,
      provider: "google_routes",
      providerStatus: "ok",
      durationMinutes: 21,
      feeCents: 1000,
      pricingBand: "21-30",
    });
    expect(result.distanceMiles).toBeCloseTo(8.7, 1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("routes.googleapis.com"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
        }),
      }),
    );
  });

  it("rejects full addresses over the configured drive-time limit", async () => {
    mockGoogleRoute("1801s");

    const result = await checkDeliveryAddressWithRoutes(
      {
        line1: "123 Main St",
        city: "Canton",
        state: "GA",
        postalCode: "30114",
      },
      settings,
    );

    expect(result).toMatchObject({
      eligible: false,
      provider: "google_routes",
      providerStatus: "over_limit",
      durationMinutes: 31,
    });
    expect(result.message).toContain("outside our 30-minute delivery range");
  });

  it("blocks checkout when Google cannot verify a full address", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
    } as Response);

    const result = await checkDeliveryAddressWithRoutes(
      {
        line1: "123 Main St",
        city: "Canton",
        state: "GA",
        postalCode: "30114",
      },
      settings,
    );

    expect(result).toMatchObject({
      eligible: false,
      preliminary: false,
      provider: "google_routes",
      providerStatus: "unavailable",
    });
    expect(result.message).toContain("Delivery could not be verified");
  });
});
