import type { DeliveryWindow, Product, WeeklyMenuItem } from "./types";

export const bakery = {
  name: "Luna & Lorelai's Sourdough",
  domain: "landlsourdough.com",
  location: "Canton, GA",
  cutoffDay: "Thursday",
  cutoffHour: "8:00 PM",
  deliveryPromise:
    "Local delivery from Canton, Georgia. No shipping or out-of-state orders in v1.",
  complianceNotes: [
    "Confirm Georgia cottage food license and labels before launch.",
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
    imageUrl: null,
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
    imageUrl: null,
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
    imageUrl: null,
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
    imageUrl: null,
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
    imageUrl: null,
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

export const deliveryWindows: DeliveryWindow[] = [
  {
    id: "wed-afternoon",
    label: "Wednesday, 3:00-6:00 PM",
    startsAt: "2026-07-15T15:00:00-04:00",
    endsAt: "2026-07-15T18:00:00-04:00",
    capacity: 16,
    reserved: 5,
  },
  {
    id: "thu-morning",
    label: "Thursday, 9:00 AM-12:00 PM",
    startsAt: "2026-07-16T09:00:00-04:00",
    endsAt: "2026-07-16T12:00:00-04:00",
    capacity: 12,
    reserved: 4,
  },
  {
    id: "fri-afternoon",
    label: "Friday, 2:00-5:00 PM",
    startsAt: "2026-07-17T14:00:00-04:00",
    endsAt: "2026-07-17T17:00:00-04:00",
    capacity: 12,
    reserved: 3,
  },
];

export const aiKnowledge = [
  `${bakery.name} is a local cottage bakery in ${bakery.location}.`,
  "Orders are intended for local Georgia delivery only. The v1 site does not ship bread.",
  "Weekly orders close every Thursday at 8:00 PM for the next week's bake and delivery schedule.",
  "After the cutoff, customers can send a last-minute request, but it is not guaranteed.",
  "All product allergen details must come from the product cards. Do not claim allergen-free preparation.",
  "Allowed delivery ZIP codes and delivery fee are configured by the bakery owner before launch.",
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
