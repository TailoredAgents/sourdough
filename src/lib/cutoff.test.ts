import { describe, expect, it } from "vitest";
import { isRequestDeliveryWeek } from "./bake-schedule";
import { getCutoffMessage, isAfterWeeklyCutoff } from "./cutoff";

describe("weekly cutoff", () => {
  it("uses the editable menu cutoff when present", () => {
    const cutoff = "2026-07-10T00:00:00.000Z";

    expect(isAfterWeeklyCutoff(cutoff, new Date("2026-07-09T23:59:59.000Z"))).toBe(
      false,
    );
    expect(isAfterWeeklyCutoff(cutoff, new Date("2026-07-10T00:00:00.000Z"))).toBe(
      true,
    );
  });

  it("falls back to Thursday 11:59 PM Eastern when no menu cutoff exists", () => {
    expect(isAfterWeeklyCutoff(null, new Date("2026-07-10T03:59:00.000Z"))).toBe(
      false,
    );
    expect(isAfterWeeklyCutoff(null, new Date("2026-07-10T04:00:00.000Z"))).toBe(
      true,
    );
  });

  it("formats a menu-specific cutoff message", () => {
    expect(
      getCutoffMessage(
        "2026-07-10T00:00:00.000Z",
        new Date("2026-07-09T12:00:00.000Z"),
      ),
    ).toContain("Order by");
  });

  it("marks delivery weeks as requests only after cutoff and before delivery ends", () => {
    const cutoff = "2026-07-24T04:00:00.000Z";
    const deliveryEnd = "2026-07-26T22:00:00.000Z";

    expect(
      isRequestDeliveryWeek(cutoff, deliveryEnd, new Date("2026-07-23T16:00:00.000Z")),
    ).toBe(false);
    expect(
      isRequestDeliveryWeek(cutoff, deliveryEnd, new Date("2026-07-24T04:00:00.000Z")),
    ).toBe(true);
    expect(
      isRequestDeliveryWeek(cutoff, deliveryEnd, new Date("2026-07-26T22:00:00.000Z")),
    ).toBe(false);
  });
});
