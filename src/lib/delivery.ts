import { envNumber } from "./utils";
import type { DeliveryAddress } from "./types";

export type DeliverySettings = {
  radiusMiles: number;
  deliveryFeeCents: number;
  center: {
    lat: number;
    lng: number;
  };
};

type CityEstimate = {
  key: string;
  label: string;
  milesFromCanton: number;
};

const knownCities: CityEstimate[] = [
  { key: "canton", label: "Canton", milesFromCanton: 0 },
  { key: "holly springs", label: "Holly Springs", milesFromCanton: 7 },
  { key: "woodstock", label: "Woodstock", milesFromCanton: 13 },
  { key: "waleska", label: "Waleska", milesFromCanton: 10 },
  { key: "ball ground", label: "Ball Ground", milesFromCanton: 11 },
  { key: "jasper", label: "Jasper", milesFromCanton: 22 },
  { key: "alpharetta", label: "Alpharetta", milesFromCanton: 24 },
  { key: "roswell", label: "Roswell", milesFromCanton: 25 },
  { key: "marietta", label: "Marietta", milesFromCanton: 27 },
];

export function getDeliverySettings(): DeliverySettings {
  return {
    radiusMiles: envNumber("DELIVERY_RADIUS_MILES", 12),
    deliveryFeeCents: envNumber("DELIVERY_FEE_CENTS", 600),
    center: {
      lat: envNumber("DELIVERY_CENTER_LAT", 34.2368),
      lng: envNumber("DELIVERY_CENTER_LNG", -84.4908),
    },
  };
}

export function checkDeliveryAddress(
  address: DeliveryAddress,
  settings = getDeliverySettings(),
) {
  const state = address.state.trim().toUpperCase();

  if (state !== "GA" && state !== "GEORGIA") {
    return {
      eligible: false,
      needsReview: false,
      miles: null,
      message: "Delivery is only available within Georgia for launch.",
      feeCents: settings.deliveryFeeCents,
    };
  }

  const city = address.city.trim().toLowerCase();
  const estimate = knownCities.find((item) => item.key === city);

  if (!estimate) {
    return {
      eligible: false,
      needsReview: true,
      miles: null,
      message:
        "This city needs manual review. Send a last-minute or delivery request and the bakery will confirm.",
      feeCents: settings.deliveryFeeCents,
    };
  }

  const eligible = estimate.milesFromCanton <= settings.radiusMiles;

  return {
    eligible,
    needsReview: false,
    miles: estimate.milesFromCanton,
    message: eligible
      ? `${estimate.label} is inside the ${settings.radiusMiles}-mile delivery radius.`
      : `${estimate.label} appears outside the ${settings.radiusMiles}-mile delivery radius.`,
    feeCents: settings.deliveryFeeCents,
  };
}
