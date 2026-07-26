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
    expect(getBreadClubCheckoutGate("customer@example.com")).toEqual({
      allowed: false,
      reason: "Bread Club enrollment is not open yet.",
    });
  });

  it("allows only the owner allowlist during disabled tax review", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BREAD_CLUB_PUBLIC_ENABLED", "false");
    vi.stubEnv("BREAD_CLUB_TAX_STATUS", "pending");
    vi.stubEnv("BREAD_CLUB_TEST_EMAILS", "owner@example.com");
    expect(getBreadClubCheckoutGate("OWNER@example.com")).toEqual({
      allowed: true,
      reason: null,
    });
    expect(getBreadClubCheckoutGate("customer@example.com").allowed).toBe(
      false,
    );
  });

  it("opens public checkout only after a resolved tax status", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BREAD_CLUB_PUBLIC_ENABLED", "true");
    vi.stubEnv("BREAD_CLUB_TEST_EMAILS", "");
    vi.stubEnv("BREAD_CLUB_TAX_STATUS", "pending");
    expect(getBreadClubCheckoutGate("customer@example.com").allowed).toBe(
      false,
    );
    vi.stubEnv("BREAD_CLUB_TAX_STATUS", "registered");
    expect(getBreadClubTaxStatus()).toBe("registered");
    expect(getBreadClubCheckoutGate("customer@example.com")).toEqual({
      allowed: true,
      reason: null,
    });
  });
});
