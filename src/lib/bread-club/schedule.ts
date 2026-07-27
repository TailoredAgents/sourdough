import type { OrderingWeek } from "@/lib/types";
import type {
  BreadClubEnrollmentWeek,
  BreadClubPlan,
  BreadClubSelection,
} from "./types";

export function getBreadClubEnrollmentWeeks(
  orderingWeeks: OrderingWeek[],
  now = new Date(),
) {
  return orderingWeeks
    .filter(({ weeklyMenu, deliveryWindows }) => {
      const cutoff = new Date(weeklyMenu.orderCutoffAt);
      const window = deliveryWindows[0];
      return (
        window &&
        cutoff.getTime() > now.getTime() &&
        new Date(window.endsAt).getTime() > now.getTime() &&
        window.reserved < window.capacity
      );
    })
    .slice(0, 4)
    .map<BreadClubEnrollmentWeek>(({ weeklyMenu, deliveryWindows, menu }) => ({
      weeklyMenu,
      deliveryWindow: deliveryWindows[0],
      menu,
      selection: [],
    }));
}
export function getProductsAvailableForAllWeeks(
  plan: BreadClubPlan,
  weeks: BreadClubEnrollmentWeek[],
) {
  return plan.eligibleProducts.filter((product) =>
    isBreadClubProductAvailableForAllWeeks(product.id, weeks),
  );
}

export function isBreadClubProductAvailableForAllWeeks(
  productId: string,
  weeks: BreadClubEnrollmentWeek[],
  quantity = 1,
) {
  return (
    weeks.length > 0 &&
    weeks.every((week) => {
      const menuProduct = week.menu.find((item) => item.id === productId);
      return Boolean(
        menuProduct &&
          menuProduct.active &&
          !menuProduct.unavailable &&
          menuProduct.remainingQuantity >= quantity,
      );
    })
  );
}

export function getDefaultBreadClubSelection(
  plan: BreadClubPlan,
  weeks: BreadClubEnrollmentWeek[],
): BreadClubSelection[] {
  const availableProducts = getProductsAvailableForAllWeeks(plan, weeks).sort(
    (left, right) =>
      Number(right.guaranteed) - Number(left.guaranteed) ||
      left.name.localeCompare(right.name),
  );
  const selection: BreadClubSelection[] = [];
  let remaining = plan.loavesPerWeek;

  for (const product of availableProducts) {
    if (remaining === 0) break;

    let reservable = remaining;
    while (
      reservable > 0 &&
      !isBreadClubProductAvailableForAllWeeks(
        product.id,
        weeks,
        reservable,
      )
    ) {
      reservable -= 1;
    }
    if (reservable === 0) continue;

    selection.push({ productId: product.id, quantity: reservable });
    remaining -= reservable;
  }

  return remaining === 0 ? selection : [];
}

export function buildCycleFulfillmentInput(
  weeks: BreadClubEnrollmentWeek[],
  selection: BreadClubSelection[],
) {
  return weeks.map((week) => ({
    weekly_menu_id: week.weeklyMenu.id,
    delivery_window_id: week.deliveryWindow.id,
    selection: selection.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity,
    })),
  }));
}
