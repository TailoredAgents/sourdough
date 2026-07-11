import { getCutoffMessage } from "./cutoff";
import type { DeliverySettings } from "./delivery";
import type { MenuProduct, WeeklyMenu } from "./types";

export type ChatFallbackContext = {
  menu?: MenuProduct[];
  weeklyMenu?: Pick<WeeklyMenu, "orderCutoffAt"> | null;
  deliverySettings?: DeliverySettings;
};

function listAllowedZips(settings?: DeliverySettings) {
  return settings?.allowedPostalCodes?.length
    ? settings.allowedPostalCodes.join(", ")
    : "the posted local delivery ZIP codes";
}

function findPostalCode(message: string) {
  return message.match(/\b\d{5}\b/)?.[0] ?? null;
}

function menuSummary(menu: MenuProduct[]) {
  const availableItems = menu.filter((item) => item.remainingQuantity > 0);
  if (!availableItems.length) {
    return "The current bake drop is sold out or not available for checkout right now.";
  }

  return `Current menu availability:\n${availableItems
    .map((item) => `${item.name}: ${item.remainingQuantity} left`)
    .join("\n")}`;
}

export function buildChatFallbackAnswer(
  message: string,
  context: ChatFallbackContext = {},
) {
  const lower = message.toLowerCase();
  const postalCode = findPostalCode(message);

  if (
    lower.includes("medical") ||
    lower.includes("doctor") ||
    lower.includes("safe for") ||
    lower.includes("celiac") ||
    lower.includes("diabetes")
  ) {
    return "I cannot give medical or dietary safety advice. Please review the listed ingredients and allergens, and contact the bakery directly before ordering.";
  }

  if (lower.includes("legal") || lower.includes("law") || lower.includes("license")) {
    return "I cannot give legal advice. Please consult the appropriate agency or professional for cottage-food, tax, or local business requirements.";
  }

  if (
    lower.includes("allergen-free") ||
    lower.includes("gluten-free") ||
    lower.includes("nut-free") ||
    lower.includes("allergy")
  ) {
    return "The bakery does not claim allergen-free preparation. Please use the listed allergens on each product card and contact the bakery before ordering with allergy questions.";
  }

  if (lower.includes("allergen") || lower.includes("ingredient")) {
    return "Please check each product card for listed ingredients and allergens. The bakery does not claim allergen-free preparation; contact the bakery for ingredient questions before ordering.";
  }

  if (lower.includes("shipping") || lower.includes("ship")) {
    return "Luna & Lorelai's Sourdough offers local Georgia delivery from Canton, GA only. Shipping and out-of-state orders are not available.";
  }

  if (lower.includes("deliver") || lower.includes("zip") || postalCode) {
    const allowedZips = context.deliverySettings?.allowedPostalCodes ?? [];
    if (postalCode) {
      return allowedZips.includes(postalCode)
        ? `${postalCode} is inside the current local delivery area.`
        : `${postalCode} is outside the current local delivery area. Delivery is available in these ZIP codes: ${listAllowedZips(context.deliverySettings)}.`;
    }

    return `Local delivery is available from Canton, GA in these ZIP codes: ${listAllowedZips(context.deliverySettings)}. Shipping and out-of-state orders are not available.`;
  }

  if (lower.includes("cutoff") || lower.includes("deadline") || lower.includes("late")) {
    return getCutoffMessage(context.weeklyMenu?.orderCutoffAt);
  }

  if (
    lower.includes("menu") ||
    lower.includes("product") ||
    lower.includes("available") ||
    lower.includes("left") ||
    lower.includes("sold out")
  ) {
    return context.menu?.length
      ? menuSummary(context.menu)
      : "Ordering is not open yet. Please check back for the next bake drop.";
  }

  if (lower.includes("custom") || lower.includes("special order")) {
    return "Custom requests need direct bakery confirmation. Add the request in the order notes or contact the bakery before assuming it is available.";
  }

  return "I can help with the weekly menu, listed allergens, local delivery, and the current order cutoff. For custom or urgent questions, send a note with your order request so the bakery can reply directly.";
}
