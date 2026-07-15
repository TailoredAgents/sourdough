import { describe, expect, it } from "vitest";
import {
  getFallbackDeliveryWindows,
  getFallbackWeeklyMenu,
} from "./bakery-data";
import { canUseLocalFallback } from "./storefront-data";

describe("storefront data fallback safety", () => {
  it("uses local fallback data only outside production", () => {
    expect(canUseLocalFallback("development")).toBe(true);
    expect(canUseLocalFallback("test")).toBe(true);
    expect(canUseLocalFallback("production")).toBe(false);
  });

  it("keeps fallback weekly menu dates in the future", () => {
    const now = new Date("2026-07-15T12:00:00.000Z");
    const weeklyMenu = getFallbackWeeklyMenu(now);
    const windows = getFallbackDeliveryWindows(now);

    expect(new Date(weeklyMenu.orderCutoffAt).getTime()).toBeGreaterThan(
      now.getTime(),
    );
    expect(new Date(weeklyMenu.startsAt).getTime()).toBeGreaterThan(now.getTime());
    expect(new Date(weeklyMenu.endsAt).getTime()).toBeGreaterThan(
      new Date(weeklyMenu.startsAt).getTime(),
    );
    expect(windows).toHaveLength(3);
    expect(
      windows.every(
        (window) =>
          new Date(window.startsAt).getTime() > now.getTime() &&
          new Date(window.endsAt).getTime() > new Date(window.startsAt).getTime(),
      ),
    ).toBe(true);
  });
});
