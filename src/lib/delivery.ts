import { envNumber } from "./utils";
import type { DeliveryAddress } from "./types";

export type DeliverySettings = {
  radiusMiles: number;
  deliveryFeeCents: number;
  allowedPostalCodes: string[];
  serviceAreaCopy: string;
  center: {
    lat: number;
    lng: number;
  };
};

const defaultAllowedPostalCodes = [
  "30114",
  "30115",
  "30107",
  "30183",
  "30188",
  "30189",
];

export type DeliveryCheckResult = {
  eligible: boolean;
  needsReview: boolean;
  miles: number | null;
  message: string;
  feeCents: number;
  postalCode: string | null;
  allowedPostalCodes: string[];
};

function envList(name: string, fallback: string[]) {
  const value = process.env[name];
  if (!value) return fallback;
  const items = value
    .split(",")
    .map((item) => normalizePostalCode(item))
    .filter((item): item is string => Boolean(item));
  return items.length ? items : fallback;
}

export function normalizePostalCode(value: string) {
  const normalized = value.trim();
  return /^\d{5}$/.test(normalized) ? normalized : null;
}

export function getDeliverySettings(): DeliverySettings {
  return {
    radiusMiles: envNumber("DELIVERY_RADIUS_MILES", 12),
    deliveryFeeCents: envNumber("DELIVERY_FEE_CENTS", 600),
    allowedPostalCodes: envList(
      "DELIVERY_ALLOWED_POSTAL_CODES",
      defaultAllowedPostalCodes,
    ),
    serviceAreaCopy:
      process.env.DELIVERY_SERVICE_AREA_COPY ||
      "We deliver to selected ZIP codes around Canton and Woodstock: 30114, 30115, 30107, 30183, 30188, and 30189.",
    center: {
      lat: envNumber("DELIVERY_CENTER_LAT", 34.2368),
      lng: envNumber("DELIVERY_CENTER_LNG", -84.4908),
    },
  };
}

export function checkDeliveryAddress(
  address: DeliveryAddress,
  settings = getDeliverySettings(),
): DeliveryCheckResult {
  const state = address.state.trim().toUpperCase();
  const allowedPostalCodes = settings.allowedPostalCodes.map((item) => item.trim());
  const postalCode = normalizePostalCode(address.postalCode);

  if (state !== "GA" && state !== "GEORGIA") {
    return {
      eligible: false,
      needsReview: false,
      miles: null,
      message: "Delivery is currently available only within Georgia.",
      feeCents: settings.deliveryFeeCents,
      postalCode,
      allowedPostalCodes,
    };
  }

  if (!postalCode) {
    return {
      eligible: false,
      needsReview: false,
      miles: null,
      message: "Enter a valid 5-digit Georgia ZIP code for delivery.",
      feeCents: settings.deliveryFeeCents,
      postalCode: null,
      allowedPostalCodes,
    };
  }

  const eligible = allowedPostalCodes.includes(postalCode);

  return {
    eligible,
    needsReview: false,
    miles: null,
    message: eligible
      ? `${postalCode} is in our local delivery area.`
      : `${postalCode} is outside our current delivery area. ${settings.serviceAreaCopy}`,
    feeCents: settings.deliveryFeeCents,
    postalCode,
    allowedPostalCodes,
  };
}
