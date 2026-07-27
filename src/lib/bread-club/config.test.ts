import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getBreadClubCheckoutGate,
  getBreadClubTaxStatus,
} from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Bread Club launch gates", () => {
  it("blocks public enrollment while the feature is disabled", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BREAD_CLUB_PUBLIC_ENABLED", "false");
    vi.stubEnv("BREAD_CLUB_TAX_STATUS", "registered");
    vi.stubEnv("BREAD_CLUB_TEST_EMAILS", "owner@example.com");
    expect(
      getBreadClubCheckoutGate("customer@example.com", null),
    ).toEqual({
      allowed: false,
      reason: "Bread Club enrollment is not open yet.",
    });
  });

  it("requires the submitted email to match the signed-in owner", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BREAD_CLUB_PUBLIC_ENABLED", "false");
    vi.stubEnv("BREAD_CLUB_TAX_STATUS", "pending");
    vi.stubEnv("BREAD_CLUB_TEST_EMAILS", "owner@example.com");
    expect(
      getBreadClubCheckoutGate("OWNER@example.com", "owner@example.com"),
    ).toEqual({ allowed: true, reason: null });
    expect(
      getBreadClubCheckoutGate("owner@example.com", null).allowed,
    ).toBe(false);
    expect(
      getBreadClubCheckoutGate(
        "owner@example.com",
        "another-admin@example.com",
      ).allowed,
    ).toBe(false);
    expect(
      getBreadClubCheckoutGate(
        "another-admin@example.com",
        "another-admin@example.com",
      ),
    ).toEqual({ allowed: true, reason: null });
  });

  it("allows local checkout tests without production owner authentication", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BREAD_CLUB_PUBLIC_ENABLED", "false");
    vi.stubEnv("BREAD_CLUB_TAX_STATUS", "pending");
    vi.stubEnv("BREAD_CLUB_TEST_EMAILS", "");
    expect(
      getBreadClubCheckoutGate("member@example.com", null),
    ).toEqual({ allowed: true, reason: null });
  });

  it("opens public checkout only after a resolved tax status", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BREAD_CLUB_PUBLIC_ENABLED", "true");
    vi.stubEnv("BREAD_CLUB_TEST_EMAILS", "");
    vi.stubEnv("BREAD_CLUB_TAX_STATUS", "pending");
    expect(
      getBreadClubCheckoutGate("customer@example.com", null).allowed,
    ).toBe(false);
    vi.stubEnv("BREAD_CLUB_TAX_STATUS", "registered");
    expect(getBreadClubTaxStatus()).toBe("registered");
    expect(
      getBreadClubCheckoutGate("customer@example.com", null),
    ).toEqual({ allowed: true, reason: null });
  });
});
