import { describe, expect, it } from "vitest";
import {
  canOrderMenuProduct,
  getMenuProductAvailabilityLabel,
  isWeeklyMenuItemUnavailable,
} from "./menu-availability";

describe("menu availability helpers", () => {
  it("treats a visible zero-inventory item as intentionally unavailable", () => {
    expect(isWeeklyMenuItemUnavailable({ availableQuantity: 0, soldQuantity: 0 })).toBe(
      true,
    );
    expect(isWeeklyMenuItemUnavailable({ availableQuantity: 10, soldQuantity: 10 })).toBe(
      false,
    );
  });

  it("separates unavailable, in-stock, and sold-out labels", () => {
    expect(
      getMenuProductAvailabilityLabel({ unavailable: true, remainingQuantity: 0 }),
    ).toBe("Currently unavailable");
    expect(
      getMenuProductAvailabilityLabel({ unavailable: false, remainingQuantity: 4 }),
    ).toBe("4 left this week");
    expect(
      getMenuProductAvailabilityLabel({ unavailable: false, remainingQuantity: 0 }),
    ).toBe("Sold out this week");
  });

  it("blocks unavailable items from ordering", () => {
    expect(canOrderMenuProduct({ unavailable: true, remainingQuantity: 10 })).toBe(false);
    expect(canOrderMenuProduct({ unavailable: false, remainingQuantity: 1 })).toBe(true);
    expect(canOrderMenuProduct({ unavailable: false, remainingQuantity: 0 })).toBe(false);
  });
});
