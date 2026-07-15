import { describe, expect, it } from "vitest";
import { bakeNotifySignupSchema, buildBakeNotifySignupBody } from "./customer-messages";

describe("bake notification signup", () => {
  it("allows a blank ZIP or a 5-digit ZIP", () => {
    expect(
      bakeNotifySignupSchema.safeParse({
        email: "customer@example.com",
        postalCode: "",
      }).success,
    ).toBe(true);

    const parsed = bakeNotifySignupSchema.safeParse({
      email: "customer@example.com",
      postalCode: " 30114 ",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.postalCode).toBe("30114");
    }
  });

  it("rejects invalid signup ZIPs with customer-specific feedback", () => {
    const parsed = bakeNotifySignupSchema.safeParse({
      email: "customer@example.com",
      postalCode: "Canton",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe(
        "Enter a 5-digit ZIP code or leave it blank.",
      );
    }
  });

  it("stores normalized signup details for owner follow-up", () => {
    expect(
      buildBakeNotifySignupBody({
        email: " Customer@Example.com ",
        postalCode: "30114",
        preference: "Next weekly bake menu",
        source: "homepage",
      }),
    ).toContain("Email: customer@example.com\nZIP: 30114");
  });
});
