import { afterEach, describe, expect, it } from "vitest";
import { isCronRequestAuthorized } from "./cron-auth";

const originalSecret = process.env.CRON_SECRET;

afterEach(() => {
  process.env.CRON_SECRET = originalSecret;
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
});
