import { describe, expect, it } from "vitest";
import { getSafeLocalRedirectUrl } from "./safe-redirect";

const siteUrl = "https://www.landlsourdough.com";

describe("safe local redirect", () => {
  it("allows local destinations", () => {
    expect(
      getSafeLocalRedirectUrl(
        "/admin?section=orders",
        siteUrl,
        "/admin",
      ).toString(),
    ).toBe("https://www.landlsourdough.com/admin?section=orders");
  });

  it("rejects absolute and protocol-relative external destinations", () => {
    expect(
      getSafeLocalRedirectUrl(
        "https://attacker.example/phish",
        siteUrl,
        "/admin",
      ).pathname,
    ).toBe("/admin");
    expect(
      getSafeLocalRedirectUrl(
        "//attacker.example/phish",
        siteUrl,
        "/admin",
      ).pathname,
    ).toBe("/admin");
  });
});
