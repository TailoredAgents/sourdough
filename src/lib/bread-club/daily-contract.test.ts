import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const daily = readFileSync("src/lib/bread-club/daily.ts", "utf8");

describe("Bread Club daily job contract", () => {
  it("uses the unambiguous fulfillment order relationship", () => {
    expect(daily).toContain(
      "orders!bread_club_fulfillments_order_id_fkey(status)",
    );
  });

  it("claims stable keys before reminders, credits, and Friday summaries", () => {
    expect(daily).toContain("credit-invoice-item:${credit.id}");
    expect(daily).toContain("selection-reminder:${fulfillment.id}");
    expect(daily).toContain("friday-summary:${localDateKey(now)}");
    expect(daily).toContain("if (!insertError) return true");
    expect(daily).toContain("existing.status === \"completed\"");
  });
});
