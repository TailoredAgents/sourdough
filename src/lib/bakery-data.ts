import type { DeliveryWindow, Product, WeeklyMenu, WeeklyMenuItem } from "./types";

export const bakery = {
  name: "Luna & Lorelai's Sourdough",
  domain: "landlsourdough.com",
  orderEmail: "orders@landlsourdough.com",
  location: "Canton, GA",
  cutoffDay: "Thursday",
  cutoffHour: "8:00 PM",
  deliveryPromise:
    "Local delivery in the Canton, Georgia area. Shipping is not currently available.",
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

function daysFrom(now: Date, days: number, hour: number, minute = 0) {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function formatDeliveryWindowLabel(startsAt: Date, endsAt: Date) {
  const day = new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  }).format(startsAt);
  const time = new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });

  return `${day}, ${time.format(startsAt)}-${time.format(endsAt)}`;
}

export function getFallbackBakeDates(now = new Date()) {
  const orderCutoffAt = daysFrom(now, 1, 20);
  const startsAt = daysFrom(now, 2, 0);
  const endsAt = daysFrom(now, 5, 23, 59);

  return {
    orderCutoffAt,
    startsAt,
    endsAt,
  };
}

export function getFallbackDeliveryWindows(now = new Date()): DeliveryWindow[] {
  const firstStart = daysFrom(now, 2, 15);
  const firstEnd = daysFrom(now, 2, 18);
  const secondStart = daysFrom(now, 3, 9);
  const secondEnd = daysFrom(now, 3, 12);
  const thirdStart = daysFrom(now, 4, 14);
  const thirdEnd = daysFrom(now, 4, 17);

  return [
    {
      id: "starter-window-1",
      label: formatDeliveryWindowLabel(firstStart, firstEnd),
      startsAt: firstStart.toISOString(),
      endsAt: firstEnd.toISOString(),
      capacity: 16,
      reserved: 5,
    },
    {
      id: "starter-window-2",
      label: formatDeliveryWindowLabel(secondStart, secondEnd),
      startsAt: secondStart.toISOString(),
      endsAt: secondEnd.toISOString(),
      capacity: 12,
      reserved: 4,
    },
    {
      id: "starter-window-3",
      label: formatDeliveryWindowLabel(thirdStart, thirdEnd),
      startsAt: thirdStart.toISOString(),
      endsAt: thirdEnd.toISOString(),
      capacity: 12,
      reserved: 3,
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
  "Orders are for local Georgia delivery only. Shipping is not currently available.",
  "The current order cutoff is set on the active weekly menu and shown before checkout.",
  "After the posted cutoff, customers can send a request and the bakery will confirm availability.",
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
    remainingQuantity: Math.max(item.availableQuantity - item.soldQuantity, 0),
  };
}

export function getActiveMenu() {
  return weeklyMenu
    .map((item) => getMenuProduct(item.productId))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}
