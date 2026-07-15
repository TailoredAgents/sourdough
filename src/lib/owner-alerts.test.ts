import { afterEach, describe, expect, it } from "vitest";
import {
  buildOwnerAlertMessage,
  buildOwnerAlertSubject,
  getOwnerAlertRecipients,
} from "./owner-alerts";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("owner alerts", () => {
  it("builds short customer-facing order alert text", () => {
    expect(
      buildOwnerAlertMessage({
        type: "order",
        customerName: "Jane Smith",
        orderSummary: "1 x Classic Country Loaf\n1 x Whipped Honey Butter",
        notes: "Leave on porch",
      }),
    ).toBe(
      "New order: Jane Smith\nOrder: 1 x Classic Country Loaf 1 x Whipped Honey Butter\nNotes: Leave on porch",
    );
  });

  it("builds inquiry subjects with the customer label", () => {
    expect(buildOwnerAlertSubject("inquiry", "Website visitor")).toBe(
      "New inquiry: Website visitor",
    );
  });

  it("uses email and SMS email destinations without duplicates", () => {
    process.env.OWNER_ALERT_EMAIL = "orders@landlsourdough.com";
    process.env.OWNER_ALERT_SMS_EMAIL =
      "4703880184@vtext.com, orders@landlsourdough.com";

    expect(getOwnerAlertRecipients()).toEqual([
      "orders@landlsourdough.com",
      "4703880184@vtext.com",
    ]);
  });
});
