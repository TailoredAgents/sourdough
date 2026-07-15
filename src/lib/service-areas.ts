import type { DeliverySettings } from "./delivery";

export function serviceAreaPath(postalCode: string) {
  return `/sourdough-delivery/${postalCode}`;
}

export function serviceAreaTitle(postalCode: string) {
  return `Sourdough Delivery in ZIP ${postalCode}`;
}

export function serviceAreaDescription(postalCode: string) {
  return `Order weekly sourdough loaves and small-batch add-ons for local delivery in ZIP ${postalCode} around Canton, Georgia.`;
}

export function isAllowedServiceArea(
  postalCode: string,
  deliverySettings: DeliverySettings,
) {
  return deliverySettings.allowedPostalCodes.includes(postalCode);
}
