import { describe, expect, it } from "vitest";
import { buildChatFallbackAnswer } from "./chat-fallback";
import type { DeliverySettings } from "./delivery";
import type { MenuProduct } from "./types";

const deliverySettings: DeliverySettings = {
  radiusMiles: 12,
  deliveryFeeCents: 600,
  allowedPostalCodes: ["30114", "30115"],
  serviceAreaCopy: "Delivery is available in selected local ZIP codes.",
  center: { lat: 34.2368, lng: -84.4908 },
};

const menu: MenuProduct[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    productId: "00000000-0000-4000-8000-000000000001",
    name: "Classic Country Loaf",
    category: "bread",
    description: "A loaf",
    ingredients: ["flour"],
    allergens: ["Wheat"],
    priceCents: 1200,
    imageUrl: null,
    imageStyle: "from-stone-100 to-amber-100",
    active: true,
    availableQuantity: 10,
    soldQuantity: 7,
    featured: true,
    remainingQuantity: 3,
  },
];

describe("dynamic chat fallback", () => {
  it("answers delivery ZIP questions from delivery settings", () => {
    expect(
      buildChatFallbackAnswer("Do you deliver to 30114?", { deliverySettings }),
    ).toContain("inside");

    expect(
      buildChatFallbackAnswer("Do you deliver to 99999?", { deliverySettings }),
    ).toContain("30114, 30115");
  });

  it("answers menu availability from current menu inventory", () => {
    expect(buildChatFallbackAnswer("What products are left?", { menu })).toContain(
      "Classic Country Loaf: 3 left",
    );
  });

  it("uses the active menu cutoff when answering cutoff questions", () => {
    expect(
      buildChatFallbackAnswer("When is the cutoff?", {
        weeklyMenu: { orderCutoffAt: "2026-07-12T20:00:00.000Z" },
      }),
    ).toContain("Order by");
  });
});
