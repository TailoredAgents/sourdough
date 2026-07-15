import { describe, expect, it } from "vitest";
import {
  extractAdminEmailTestResult,
  summarizeAdminEmailTest,
} from "./admin-email-test";

describe("admin email test helpers", () => {
  it("extracts valid email test responses", () => {
    expect(
      extractAdminEmailTestResult({
        ok: true,
        to: "orders@landlsourdough.com",
        ownerAlertRecipients: ["orders@landlsourdough.com", "4703880184@vtext.com"],
      }),
    ).toEqual({
      ok: true,
      to: "orders@landlsourdough.com",
      ownerAlertRecipients: ["orders@landlsourdough.com", "4703880184@vtext.com"],
    });
    expect(extractAdminEmailTestResult({ ok: false })).toBeNull();
    expect(extractAdminEmailTestResult(null)).toBeNull();
  });

  it("summarizes owner alert coverage", () => {
    expect(
      summarizeAdminEmailTest({
        ok: true,
        to: "orders@landlsourdough.com",
        ownerAlertRecipients: ["orders@landlsourdough.com"],
      }),
    ).toBe("Test email sent to orders@landlsourdough.com; owner alert checked for 1 recipient.");

    expect(
      summarizeAdminEmailTest({
        ok: true,
        to: "orders@landlsourdough.com",
        ownerAlertRecipients: [],
      }),
    ).toBe("Test email sent to orders@landlsourdough.com; no owner alert recipients are configured.");
  });
});
