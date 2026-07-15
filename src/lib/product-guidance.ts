import { productSlug } from "./product-slugs";
import type { Product } from "./types";

type ProductGuidance = {
  bestFor: string;
  serving: string;
  storage: string;
};

const defaultGuidance: ProductGuidance = {
  bestFor: "weekly tables, gifting, and local delivery orders",
  serving: "Serve fresh or lightly toasted with your favorite spread.",
  storage:
    "Keep wrapped at room temperature for short-term freshness, or slice and freeze for later.",
};

const guidanceBySlug: Record<string, ProductGuidance> = {
  "classic-country-loaf": {
    bestFor: "sandwiches, toast, soup nights, and everyday slicing",
    serving:
      "Serve fresh with butter, toast thick slices, or pair with soup, eggs, cheese, and seasonal spreads.",
    storage:
      "Store cut-side down or loosely wrapped at room temperature; slice and freeze extras for easy toast.",
  },
  "rosemary-garlic-loaf": {
    bestFor: "pasta nights, soups, boards, and savory sandwiches",
    serving:
      "Warm slices before serving with olive oil, soup, roasted vegetables, pasta, or a cheese board.",
    storage:
      "Keep wrapped at room temperature and refresh slices in a toaster or warm oven before serving.",
  },
  "cinnamon-swirl-sourdough": {
    bestFor: "breakfast toast, French toast, brunch, and sweet snacks",
    serving:
      "Toast slices with butter, use for French toast, or serve warm with coffee or weekend breakfast.",
    storage:
      "Store wrapped at room temperature for short-term use; slice and freeze if saving for later breakfasts.",
  },
  "sourdough-starter-crackers": {
    bestFor: "snacking, lunch boxes, soup sides, and cheese boards",
    serving:
      "Serve with cheese, dips, soup, salad, or as a crisp snack straight from the bag.",
    storage:
      "Keep sealed at room temperature to preserve crunch and avoid moisture.",
  },
  "whipped-honey-butter": {
    bestFor: "warm toast, cinnamon sourdough, gifting, and breakfast spreads",
    serving:
      "Spread on warm sourdough, cinnamon slices, biscuits, pancakes, or roasted sweet potatoes.",
    storage:
      "Keep chilled until ready to serve, then let it soften briefly for easier spreading.",
  },
};

export function getProductGuidance(product: Pick<Product, "name">) {
  return guidanceBySlug[productSlug(product)] ?? defaultGuidance;
}
