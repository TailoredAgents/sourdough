import { describe, expect, it } from "vitest";
import { getFallbackOrderingWeeks } from "./bakery-data";
import { getBreadClubEnrollmentWeeks } from "./bread-club/schedule";

describe("fallback ordering weeks", () => {
  it("mirrors the five-week production schedule and keeps four future enrollment Sundays", () => {
    const now = new Date("2026-07-26T20:00:00.000Z");
    const weeks = getFallbackOrderingWeeks(now);

    expect(weeks).toHaveLength(5);
    expect(new Set(weeks.map((week) => week.weeklyMenu.id)).size).toBe(5);
    expect(
      weeks.every(
        (week) =>
          week.deliveryWindows.length === 1 &&
          week.deliveryWindows[0].weeklyMenuId === week.weeklyMenu.id,
      ),
    ).toBe(true);

    const enrollmentWeeks = getBreadClubEnrollmentWeeks(weeks, now);
    expect(enrollmentWeeks).toHaveLength(4);
    expect(enrollmentWeeks[0].deliveryWindow.startsAt).toBe(
      "2026-08-02T19:00:00.000Z",
    );
  });
});
