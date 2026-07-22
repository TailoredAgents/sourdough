import { envNumber } from "./utils";
import type { DeliveryAddress } from "./types";

const GOOGLE_ROUTES_ENDPOINT =
  "https://routes.googleapis.com/directions/v2:computeRoutes";
const GOOGLE_ROUTES_TIMEOUT_MS = 4_000;
const METERS_PER_MILE = 1609.344;

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
  preliminary: boolean;
  provider?: "zip" | "google_routes";
  providerStatus?:
    | "ok"
    | "missing_address"
    | "over_limit"
    | "unavailable"
    | "error";
  needsReview: boolean;
  miles: number | null;
  durationMinutes?: number;
  distanceMeters?: number;
  distanceMiles?: number;
  pricingBand?: string;
  message: string;
  feeCents: number;
  postalCode: string | null;
  allowedPostalCodes: string[];
};

export type DeliveryFeeBand = {
  minMinutes: number;
  maxMinutes: number;
  feeCents: number;
};

export type GoogleRouteResult = {
  durationSeconds: number;
  distanceMeters: number;
  optimizedIntermediateWaypointIndex?: number[];
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

export function hasFullStreetAddress(address: DeliveryAddress) {
  return Boolean(
    address.line1.trim() &&
      address.city.trim() &&
      address.state.trim() &&
      normalizePostalCode(address.postalCode),
  );
}

export function formatDeliveryAddress(address: DeliveryAddress) {
  return [
    address.line1,
    address.line2,
    address.city,
    address.state,
    address.postalCode,
  ]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ");
}

export function parseGoogleDurationSeconds(value: string | null | undefined) {
  const match = String(value || "").match(/^(\d+(?:\.\d+)?)s$/);
  return match ? Math.ceil(Number(match[1])) : null;
}

export function parseDeliveryFeeBands(
  value = process.env.DELIVERY_FEE_BANDS || "",
): DeliveryFeeBand[] {
  const parsed = value
    .split(",")
    .map((entry) => {
      const [range, fee] = entry.split(":");
      const [min, max] = (range || "").split("-");
      const minMinutes = Number(min);
      const maxMinutes = Number(max);
      const feeCents = Number(fee);
      if (
        !Number.isInteger(minMinutes) ||
        !Number.isInteger(maxMinutes) ||
        !Number.isInteger(feeCents) ||
        minMinutes < 0 ||
        maxMinutes < minMinutes ||
        feeCents < 0
      ) {
        return null;
      }
      return { minMinutes, maxMinutes, feeCents };
    })
    .filter((band): band is DeliveryFeeBand => Boolean(band));

  return parsed.length
    ? parsed
    : [
        { minMinutes: 0, maxMinutes: 10, feeCents: 500 },
        { minMinutes: 11, maxMinutes: 20, feeCents: 700 },
        { minMinutes: 21, maxMinutes: 30, feeCents: 1000 },
      ];
}

export function getDeliveryFeeForDriveMinutes(
  durationMinutes: number,
  bands = parseDeliveryFeeBands(),
) {
  return bands.find(
    (band) =>
      durationMinutes >= band.minMinutes && durationMinutes <= band.maxMinutes,
  );
}

export function parseMaxDriveMinutes() {
  return envNumber("DELIVERY_MAX_DRIVE_MINUTES", 30);
}

export function getDeliveryOriginAddress() {
  return (
    process.env.DELIVERY_ORIGIN_ADDRESS ||
    "4501 Holly Springs Parkway, Canton, GA 30115"
  );
}

export function getDeliveryRouteEndAddress() {
  return (
    process.env.DELIVERY_ROUTE_END_ADDRESS ||
    "403 Three Branches Ct, Woodstock, GA 30188"
  );
}

function buildAddressWaypoint(address: string) {
  return {
    address,
  };
}

async function fetchGoogleRoute(
  body: Record<string, unknown>,
  fieldMask: string,
): Promise<GoogleRouteResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GOOGLE_ROUTES_TIMEOUT_MS);
  try {
    const response = await fetch(GOOGLE_ROUTES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": fieldMask,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const payload = (await response.json().catch(() => null)) as
      | {
          routes?: Array<{
            duration?: string;
            distanceMeters?: number;
            optimizedIntermediateWaypointIndex?: number[];
          }>;
        }
      | null;
    const route = payload?.routes?.[0];
    const durationSeconds = parseGoogleDurationSeconds(route?.duration);
    if (!route || !durationSeconds || !Number.isFinite(route.distanceMeters)) {
      return null;
    }
    return {
      durationSeconds,
      distanceMeters: Number(route.distanceMeters),
      optimizedIntermediateWaypointIndex: route.optimizedIntermediateWaypointIndex,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getGoogleDrivingRoute(
  destinationAddress: string,
  originAddress = getDeliveryOriginAddress(),
) {
  return fetchGoogleRoute(
    {
      origin: buildAddressWaypoint(originAddress),
      destination: buildAddressWaypoint(destinationAddress),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
    },
    "routes.duration,routes.distanceMeters",
  );
}

export async function getOptimizedGoogleDrivingRoute({
  originAddress = getDeliveryOriginAddress(),
  destinationAddress = getDeliveryRouteEndAddress(),
  intermediateAddresses,
}: {
  originAddress?: string;
  destinationAddress?: string;
  intermediateAddresses: string[];
}) {
  return fetchGoogleRoute(
    {
      origin: buildAddressWaypoint(originAddress),
      destination: buildAddressWaypoint(destinationAddress),
      intermediates: intermediateAddresses.map(buildAddressWaypoint),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
      optimizeWaypointOrder: true,
    },
    "routes.duration,routes.distanceMeters,routes.optimizedIntermediateWaypointIndex",
  );
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
      preliminary: false,
      provider: "zip",
      providerStatus: "error",
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
      preliminary: false,
      provider: "zip",
      providerStatus: "error",
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
    preliminary: true,
    provider: "zip",
    providerStatus: eligible ? "missing_address" : "over_limit",
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

export async function checkDeliveryAddressWithRoutes(
  address: DeliveryAddress,
  settings = getDeliverySettings(),
): Promise<DeliveryCheckResult> {
  const preliminary = checkDeliveryAddress(address, settings);
  if (!preliminary.eligible) return { ...preliminary, preliminary: false };

  if (!hasFullStreetAddress(address)) {
    return {
      ...preliminary,
      preliminary: true,
      provider: "zip",
      providerStatus: "missing_address",
      message: `${preliminary.message} Add your full street address at checkout for exact drive time and delivery fee.`,
    };
  }

  const destination = formatDeliveryAddress(address);
  const route = await getGoogleDrivingRoute(destination);
  if (!route) {
    return {
      eligible: false,
      preliminary: false,
      provider: "google_routes",
      providerStatus: "unavailable",
      needsReview: false,
      miles: null,
      message:
        "Delivery could not be verified right now. Please try again before checkout.",
      feeCents: settings.deliveryFeeCents,
      postalCode: preliminary.postalCode,
      allowedPostalCodes: preliminary.allowedPostalCodes,
    };
  }

  const durationMinutes = Math.ceil(route.durationSeconds / 60);
  const distanceMiles = route.distanceMeters / METERS_PER_MILE;
  const maxDriveMinutes = parseMaxDriveMinutes();
  const pricingBand = getDeliveryFeeForDriveMinutes(durationMinutes);
  const routeDetails = {
    preliminary: false,
    provider: "google_routes" as const,
    needsReview: false,
    miles: Number(distanceMiles.toFixed(1)),
    durationMinutes,
    distanceMeters: route.distanceMeters,
    distanceMiles: Number(distanceMiles.toFixed(1)),
    postalCode: preliminary.postalCode,
    allowedPostalCodes: preliminary.allowedPostalCodes,
  };

  if (durationMinutes > maxDriveMinutes || !pricingBand) {
    return {
      ...routeDetails,
      eligible: false,
      providerStatus: "over_limit",
      pricingBand: pricingBand
        ? `${pricingBand.minMinutes}-${pricingBand.maxMinutes}`
        : undefined,
      message: `This address is about ${durationMinutes} minutes from the bakery, which is outside our ${maxDriveMinutes}-minute delivery range.`,
      feeCents: settings.deliveryFeeCents,
    };
  }

  return {
    ...routeDetails,
    eligible: true,
    providerStatus: "ok",
    pricingBand: `${pricingBand.minMinutes}-${pricingBand.maxMinutes}`,
    message: `Delivery is available. This address is about ${durationMinutes} minutes from the bakery. Delivery fee: $${(pricingBand.feeCents / 100).toFixed(2)}.`,
    feeCents: pricingBand.feeCents,
  };
}
