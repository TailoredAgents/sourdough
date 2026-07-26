import { afterEach, describe, expect, it } from "vitest";
import {
  buildOwnerAlertMessage,
  buildOwnerAlertSubject,
  buildOwnerSmsAlertParts,
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

  it("keeps the complete customer note within the SMS gateway budget", () => {
    const recipient = "4703880184@vtext.com";
    const parts = buildOwnerSmsAlertParts(
      {
        type: "order",
        customerName: "Jane Smith",
        orderSummary:
          "1 x Cinnamon Swirl Sourdough\n1 x Classic Country Loaf",
        notes: "testing the waters",
      },
      recipient,
    );

    expect(parts).toHaveLength(1);
    expect(parts[0].body).toContain("Note: testing the waters");
    expect(parts[0].body.indexOf("Note:")).toBeLessThan(
      parts[0].body.indexOf("1x Cinnamon"),
    );
    expect(
      recipient.length + parts[0].subject.length + parts[0].body.length,
    ).toBeLessThanOrEqual(140);
  });

  it("splits long notes into numbered gateway-safe messages", () => {
    const recipient = "4703880184@vtext.com";
    const note = Array.from(
      { length: 40 },
      (_, index) => `instruction-${index + 1}`,
    ).join(" ");
    const parts = buildOwnerSmsAlertParts(
      {
        type: "order",
        customerName: "Jane Smith",
        orderSummary: "2 x Classic Country Loaf",
        notes: note,
      },
      recipient,
    );

    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((part) => part.body).join(" ")).toContain(note);
    parts.forEach((part, index) => {
      expect(part.subject).toBe(`L&L ${index + 1}/${parts.length}`);
      expect(
        recipient.length + part.subject.length + part.body.length,
      ).toBeLessThanOrEqual(140);
    });
  });
});
