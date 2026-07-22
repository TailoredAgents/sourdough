import type { DeliveryWindow, Product, WeeklyMenu, WeeklyMenuItem } from "./types";
import {
  DEFAULT_SUNDAY_DELIVERY_CAPACITY,
  formatSundayDeliveryWindowLabel,
  getFirstVisibleDeliveryWeekSchedule,
} from "./bake-schedule";
import { isWeeklyMenuItemUnavailable } from "./menu-availability";

export const bakery = {
  name: "Luna & Lorelai's Sourdough",
  domain: "landlsourdough.com",
  orderEmail: "orders@landlsourdough.com",
  location: "Canton, GA",
  cutoffDay: "Thursday",
  cutoffHour: "11:59 PM",
  deliveryPromise:
    "Local delivery in the Canton and Woodstock, Georgia area. Shipping is not currently available.",
  complianceNotes: [
    "Confirm Georgia cottage food program rules, training, registration, and labels before launch.",
    "Confirm Canton/Cherokee home business and occupational tax requirements.",
    "Confirm sales-tax setup with an accountant before switching Stripe live.",
  ],
};

export const products: Product[] = [
  {
    id: "classic-country",
    name: "Classic Country Loaf",
    category: "bread",
    description:
      "A naturally leavened sourdough loaf with a crisp crust, tender open crumb, and mild tang.",
    ingredients: ["Organic bread flour", "filtered water", "sea salt", "starter"],
    allergens: ["Wheat"],
    priceCents: 1200,
    imageUrl: "/images/products/classic-country-loaf.webp",
    imageStyle: "from-stone-100 via-amber-100 to-orange-200",
    active: true,
  },
  {
    id: "rosemary-garlic",
    name: "Rosemary Garlic Loaf",
    category: "bread",
    description:
      "Savory sourdough folded with rosemary and roasted garlic for soups, boards, and sandwiches.",
    ingredients: [
      "Organic bread flour",
      "filtered water",
      "sea salt",
      "starter",
      "rosemary",
      "garlic",
    ],
    allergens: ["Wheat"],
    priceCents: 1400,
    imageUrl: "/images/products/rosemary-garlic-loaf.webp",
    imageStyle: "from-emerald-100 via-stone-100 to-amber-200",
    active: true,
  },
  {
    id: "cinnamon-swirl",
    name: "Cinnamon Swirl Sourdough",
    category: "bread",
    description:
      "A softer loaf with cinnamon sugar swirls, made for breakfast slices and weekend French toast.",
    ingredients: [
      "Organic bread flour",
      "filtered water",
      "sea salt",
      "starter",
      "cinnamon",
      "brown sugar",
    ],
    allergens: ["Wheat"],
    priceCents: 1500,
    imageUrl: "/images/products/cinnamon-swirl-sourdough.webp",
    imageStyle: "from-rose-100 via-amber-100 to-stone-100",
    active: true,
  },
  {
    id: "starter-crackers",
    name: "Sourdough Starter Crackers",
    category: "add-on",
    description:
      "Crisp snack crackers made from sourdough starter discard with herbs and flaky salt.",
    ingredients: ["Starter", "flour", "olive oil", "herbs", "sea salt"],
    allergens: ["Wheat"],
    priceCents: 700,
    imageUrl: "/images/products/sourdough-starter-crackers.webp",
    imageStyle: "from-yellow-100 via-stone-100 to-lime-100",
    active: true,
  },
  {
    id: "honey-butter",
    name: "Whipped Honey Butter",
    category: "add-on",
    description:
      "A small-batch sweet spread for warm slices, delivered chilled with each order.",
    ingredients: ["Butter", "local honey", "sea salt"],
    allergens: ["Milk"],
    priceCents: 600,
    imageUrl: "/images/products/whipped-honey-butter.webp",
    imageStyle: "from-yellow-50 via-amber-100 to-orange-100",
    active: true,
  },
];

export const weeklyMenu: WeeklyMenuItem[] = [
  { productId: "classic-country", availableQuantity: 18, soldQuantity: 5, featured: true },
  { productId: "rosemary-garlic", availableQuantity: 12, soldQuantity: 3, featured: true },
  { productId: "cinnamon-swirl", availableQuantity: 10, soldQuantity: 8 },
  { productId: "starter-crackers", availableQuantity: 20, soldQuantity: 4 },
  { productId: "honey-butter", availableQuantity: 20, soldQuantity: 7 },
];

export function getFallbackBakeDates(now = new Date()) {
  const schedule = getFirstVisibleDeliveryWeekSchedule(now);

  return {
    orderCutoffAt: schedule.orderCutoffAt,
    startsAt: schedule.startsAt,
    endsAt: schedule.endsAt,
  };
}

export function getFallbackDeliveryWindows(now = new Date()): DeliveryWindow[] {
  const schedule = getFirstVisibleDeliveryWeekSchedule(now);

  return [
    {
      id: "starter-sunday-window",
      label: formatSundayDeliveryWindowLabel(
        schedule.deliveryStartsAt,
        schedule.deliveryEndsAt,
      ),
      startsAt: schedule.deliveryStartsAt.toISOString(),
      endsAt: schedule.deliveryEndsAt.toISOString(),
      capacity: DEFAULT_SUNDAY_DELIVERY_CAPACITY,
      reserved: 5,
    },
  ];
}

export function getFallbackWeeklyMenu(now = new Date()): WeeklyMenu {
  const { orderCutoffAt, startsAt, endsAt } = getFallbackBakeDates(now);

  return {
    id: "starter-bake-drop",
    name: "Starter Bake Drop",
    orderCutoffAt: orderCutoffAt.toISOString(),
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    published: true,
    items: getActiveMenu(),
  };
}

export const deliveryWindows: DeliveryWindow[] = getFallbackDeliveryWindows();

export const aiKnowledge = [
  `${bakery.name} is a local cottage bakery in ${bakery.location}.`,
  "Orders are for local Georgia delivery around Canton and Woodstock only. Shipping is not currently available.",
  "Orders close Thursday at 11:59 PM, Friday is prep day, Saturday is bake day, and Sunday is local delivery from 3:00 PM to 6:00 PM.",
  "After the posted cutoff, customers can submit a paid same-week request and the bakery will approve it, move it to next Sunday if allowed, or refund it.",
  "All product allergen details must come from the product cards. Do not claim allergen-free preparation.",
  "Allowed delivery ZIP codes and delivery fee are configured by the bakery owner in admin.",
];

export function getProduct(productId: string) {
  return products.find((product) => product.id === productId);
}

export function getMenuProduct(productId: string) {
  const item = weeklyMenu.find((menuItem) => menuItem.productId === productId);
  const product = getProduct(productId);
  if (!item || !product) return null;
  return {
    ...product,
    ...item,
    unavailable: isWeeklyMenuItemUnavailable(item),
    remainingQuantity: Math.max(item.availableQuantity - item.soldQuantity, 0),
  };
}

export function getActiveMenu() {
  return weeklyMenu
    .map((item) => getMenuProduct(item.productId))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}
