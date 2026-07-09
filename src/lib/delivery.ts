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

const defaultAllowedPostalCodes = ["30114", "30115", "30107", "30183"];

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
  const match = value.trim().match(/\d{5}/);
  return match?.[0] ?? null;
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
      "Delivery is available in selected Canton-area ZIP codes: 30114, 30115, 30107, and 30183.",
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
      message: "Delivery is only available within Georgia for launch.",
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
      ? `${postalCode} is inside the launch delivery area.`
      : `${postalCode} is outside the launch delivery area. ${settings.serviceAreaCopy}`,
    feeCents: settings.deliveryFeeCents,
    postalCode,
    allowedPostalCodes,
  };
}
