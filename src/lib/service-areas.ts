import type { DeliverySettings } from "./delivery";

const serviceAreaNames: Record<string, string> = {
  "30114": "Canton, GA",
  "30115": "Canton, GA",
  "30107": "Ball Ground, GA",
  "30183": "Waleska, GA",
  "30188": "Woodstock, GA",
  "30189": "Woodstock, GA",
};

export function serviceAreaPath(postalCode: string) {
  return `/sourdough-delivery/${postalCode}`;
}

export function serviceAreaName(postalCode: string) {
  return serviceAreaNames[postalCode] || `ZIP ${postalCode}`;
}

export function serviceAreaDeliveryPagePath(postalCode: string) {
  return serviceAreaName(postalCode).startsWith("Woodstock")
    ? "/sourdough-delivery-woodstock-ga"
    : "/sourdough-delivery-canton-ga";
}

export function serviceAreaTitle(postalCode: string) {
  return `Sourdough Delivery in ZIP ${postalCode} (${serviceAreaName(postalCode)})`;
}

export function serviceAreaDescription(postalCode: string) {
  return `Order weekly sourdough loaves and small-batch add-ons for local delivery in ZIP ${postalCode} around ${serviceAreaName(postalCode)}.`;
}

export function isAllowedServiceArea(
  postalCode: string,
  deliverySettings: DeliverySettings,
) {
  return deliverySettings.allowedPostalCodes.includes(postalCode);
}
