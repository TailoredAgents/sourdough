import type { MenuProduct, WeeklyMenuItem } from "./types";

export function isWeeklyMenuItemUnavailable(
  item: Pick<WeeklyMenuItem, "availableQuantity" | "soldQuantity">,
) {
  return item.availableQuantity === 0 && item.soldQuantity === 0;
}

export function getMenuProductAvailabilityLabel(
  item: Pick<MenuProduct, "remainingQuantity" | "unavailable">,
) {
  if (item.unavailable) return "Currently unavailable";
  return item.remainingQuantity > 0
    ? `${item.remainingQuantity} left this week`
    : "Sold out this week";
}

export function canOrderMenuProduct(
  item: Pick<MenuProduct, "remainingQuantity" | "unavailable">,
) {
  return !item.unavailable && item.remainingQuantity > 0;
}
