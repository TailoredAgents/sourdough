import { describe, expect, it } from "vitest";
import {
  validateAiKnowledgeForm,
  validateDeliveryForm,
  validateProductForm,
  validateWeeklyMenuForm,
} from "./admin-form-validation";

const validWeeklyMenu = {
  name: "Launch Week Bake Drop",
  orderCutoffAt: "2026-07-16T10:00",
  startsAt: "2026-07-17T10:00",
  endsAt: "2026-07-18T10:00",
  published: true,
  items: [
    {
      included: true,
      productName: "Classic Country Loaf",
      availableQuantity: 12,
      soldQuantity: 4,
    },
  ],
};

const validDelivery = {
  deliveryFeeDollars: "6.00",
  allowedPostalCodes: "30114, 30115, 30188",
  serviceAreaCopy: "Delivery is available in selected Canton and Woodstock ZIP codes.",
  windows: [
    {
      label: "Wednesday afternoon",
      startsAt: "2026-07-17T10:00",
      endsAt: "2026-07-17T14:00",
      capacity: 12,
      reserved: 3,
    },
  ],
};

describe("admin form validation", () => {
  it("accepts valid admin editor forms", () => {
    expect(validateWeeklyMenuForm(validWeeklyMenu)).toBeNull();
    expect(validateDeliveryForm(validDelivery)).toBeNull();
    expect(
      validateProductForm({
        name: "Classic Country Loaf",
        description: "A starter loaf with crisp crust and tender crumb.",
        ingredients: "flour, water, salt",
        price: "12.00",
        imageStyle: "from-stone-100 via-amber-100 to-orange-200",
      }),
    ).toBeNull();
    expect(
      validateAiKnowledgeForm({
        title: "Delivery area",
        body: "Delivery is available in selected Canton and Woodstock ZIP codes.",
      }),
    ).toBeNull();
  });

  it("blocks published menus without products and impossible inventory counts", () => {
    expect(
      validateWeeklyMenuForm({
        ...validWeeklyMenu,
        items: [],
      }),
    ).toBe("Published menus need at least one included product.");

    expect(
      validateWeeklyMenuForm({
        ...validWeeklyMenu,
        items: [
          {
            included: true,
            productName: "Classic Country Loaf",
            availableQuantity: 2,
            soldQuantity: 3,
          },
        ],
      }),
    ).toBe("Classic Country Loaf cannot have more sold than available.");
  });

  it("blocks delivery settings that would break customer checkout", () => {
    expect(
      validateDeliveryForm({
        ...validDelivery,
        allowedPostalCodes: "30114, woodstock",
      }),
    ).toBe("Delivery ZIP codes must be 5 digits.");

    expect(
      validateDeliveryForm({
        ...validDelivery,
        windows: [
          {
            ...validDelivery.windows[0],
            capacity: 4,
            reserved: 5,
          },
        ],
      }),
    ).toBe("Wednesday afternoon cannot reserve more spots than capacity.");

    expect(
      validateDeliveryForm({
        ...validDelivery,
        windows: [
          {
            ...validDelivery.windows[0],
            remove: true,
          },
        ],
      }),
    ).toBe("Wednesday afternoon has reserved orders and cannot be removed.");
  });

  it("blocks incomplete product and AI knowledge saves before API calls", () => {
    expect(
      validateProductForm({
        name: "",
        description: "Too short",
        ingredients: "",
        price: "12.00",
        imageStyle: "from-stone-100",
      }),
    ).toBe("Product name is required.");

    expect(
      validateAiKnowledgeForm({
        title: "A",
        body: "Short",
      }),
    ).toBe("Fact title is required.");
  });
});
