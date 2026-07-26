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
    weeks.every((week) => {
      const menuProduct = week.menu.find((item) => item.id === product.id);
      return Boolean(
        menuProduct &&
          menuProduct.active &&
          !menuProduct.unavailable &&
          menuProduct.remainingQuantity >= plan.loavesPerWeek,
      );
    }),
  );
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
