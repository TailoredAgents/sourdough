import { describe, expect, it } from "vitest";
import { weeklyMenuAdminSchema } from "./weekly-menu-admin";

const validMenu = {
  name: "Future Bake Drop",
  orderCutoffAt: "2026-07-12T20:00:00.000Z",
  startsAt: "2026-07-13T12:00:00.000Z",
  endsAt: "2026-07-15T12:00:00.000Z",
  published: true,
  items: [
    {
      productId: "00000000-0000-4000-8000-000000000001",
      included: true,
      availableQuantity: 10,
      soldQuantity: 2,
      featured: false,
    },
  ],
};

describe("weekly menu admin validation", () => {
  it("accepts a valid menu", () => {
    expect(weeklyMenuAdminSchema.safeParse(validMenu).success).toBe(true);
  });

  it("rejects sold quantity higher than available quantity", () => {
    expect(
      weeklyMenuAdminSchema.safeParse({
        ...validMenu,
        items: [
          {
            ...validMenu.items[0],
            availableQuantity: 2,
            soldQuantity: 3,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects cutoff dates after the menu starts", () => {
    expect(
      weeklyMenuAdminSchema.safeParse({
        ...validMenu,
        orderCutoffAt: "2026-07-14T20:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("rejects menus that end before they start", () => {
    expect(
      weeklyMenuAdminSchema.safeParse({
        ...validMenu,
        endsAt: "2026-07-12T12:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});
