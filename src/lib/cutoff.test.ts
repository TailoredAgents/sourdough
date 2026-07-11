import { describe, expect, it } from "vitest";
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

  it("falls back to Thursday 8 PM when no menu cutoff exists", () => {
    expect(isAfterWeeklyCutoff(null, new Date("2026-07-09T23:59:00.000Z"))).toBe(
      false,
    );
    expect(isAfterWeeklyCutoff(null, new Date("2026-07-10T00:00:00.000Z"))).toBe(
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
});
