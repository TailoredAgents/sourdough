import { afterEach, describe, expect, it } from "vitest";
import {
  isBreadClubSetupRequestAuthorized,
  isCronRequestAuthorized,
} from "./cron-auth";

const originalSecret = process.env.CRON_SECRET;
const originalSetupSecret = process.env.BREAD_CLUB_SETUP_SECRET;

afterEach(() => {
  process.env.CRON_SECRET = originalSecret;
  process.env.BREAD_CLUB_SETUP_SECRET = originalSetupSecret;
});

describe("cron authentication", () => {
  it("accepts only the exact shared bearer secret", () => {
    process.env.CRON_SECRET = "bread-club-secret";
    expect(
      isCronRequestAuthorized(
        new Request("https://example.com/api/cron", {
          headers: { Authorization: "Bearer bread-club-secret" },
        }),
      ),
    ).toBe(true);
    expect(
      isCronRequestAuthorized(
        new Request("https://example.com/api/cron", {
          headers: { Authorization: "Bearer bread-club-secrex" },
        }),
      ),
    ).toBe(false);
    expect(
      isCronRequestAuthorized(
        new Request("https://example.com/api/cron"),
      ),
    ).toBe(false);
  });

  it("does not reuse the operations cron secret for Stripe setup", () => {
    process.env.CRON_SECRET = "daily-secret";
    process.env.BREAD_CLUB_SETUP_SECRET = "setup-only-secret";
    expect(
      isBreadClubSetupRequestAuthorized(
        new Request("https://example.com/api/cron/bread-club/setup", {
          headers: { Authorization: "Bearer daily-secret" },
        }),
      ),
    ).toBe(false);
    expect(
      isBreadClubSetupRequestAuthorized(
        new Request("https://example.com/api/cron/bread-club/setup", {
          headers: { Authorization: "Bearer setup-only-secret" },
        }),
      ),
    ).toBe(true);
  });
});
