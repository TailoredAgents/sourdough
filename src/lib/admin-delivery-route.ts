import {
  formatDeliveryAddress,
  getDeliveryOriginAddress,
  getDeliveryRouteEndAddress,
  getOptimizedGoogleDrivingRoute,
} from "./delivery";
import type { AdminOrder } from "./types";

const routeStatuses = new Set(["paid", "baking", "out_for_delivery"]);

export type AdminRouteStop = {
  orderId: string;
  customerName: string;
  customerPhone: string | null;
  address: string;
  orderSummary: string;
  notes: string | null;
  deliveryInstructions: string | null;
};

export type AdminSundayRoute = {
  originAddress: string;
  destinationAddress: string;
  durationMinutes: number | null;
  distanceMiles: number | null;
  stops: AdminRouteStop[];
  mapsUrl: string;
};

function orderSummary(order: AdminOrder) {
  return order.items
    .map((item) => `${item.quantity} x ${item.productName}`)
    .join(", ");
}

function buildMapsUrl({
  originAddress,
  destinationAddress,
  stops,
}: {
  originAddress: string;
  destinationAddress: string;
  stops: AdminRouteStop[];
}) {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("travelmode", "driving");
  url.searchParams.set("origin", originAddress);
  url.searchParams.set("destination", destinationAddress);
  if (stops.length) {
    url.searchParams.set("waypoints", stops.map((stop) => stop.address).join("|"));
  }
  return url.toString();
}

export function getSundayRouteCandidateOrders(orders: AdminOrder[]) {
  return orders.filter((order) => routeStatuses.has(order.status));
}

export async function buildAdminSundayRoute(
  orders: AdminOrder[],
): Promise<AdminSundayRoute> {
  const originAddress = getDeliveryOriginAddress();
  const destinationAddress = getDeliveryRouteEndAddress();
  const stops = getSundayRouteCandidateOrders(orders).map((order) => ({
    orderId: order.id,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    address: formatDeliveryAddress(order.deliveryAddress),
    orderSummary: orderSummary(order),
    notes: order.notes,
    deliveryInstructions: order.deliveryInstructions,
  }));

  if (!stops.length) {
    return {
      originAddress,
      destinationAddress,
      durationMinutes: null,
      distanceMiles: null,
      stops: [],
      mapsUrl: buildMapsUrl({ originAddress, destinationAddress, stops: [] }),
    };
  }

  const route = await getOptimizedGoogleDrivingRoute({
    originAddress,
    destinationAddress,
    intermediateAddresses: stops.map((stop) => stop.address),
  });
  if (!route) {
    throw new Error("Sunday route could not be optimized right now.");
  }

  const optimizedIndexes =
    route.optimizedIntermediateWaypointIndex?.length === stops.length
      ? route.optimizedIntermediateWaypointIndex
      : stops.map((_, index) => index);
  const optimizedStops = optimizedIndexes
    .map((index) => stops[index])
    .filter((stop): stop is AdminRouteStop => Boolean(stop));

  return {
    originAddress,
    destinationAddress,
    durationMinutes: Math.ceil(route.durationSeconds / 60),
    distanceMiles: Number((route.distanceMeters / 1609.344).toFixed(1)),
    stops: optimizedStops,
    mapsUrl: buildMapsUrl({
      originAddress,
      destinationAddress,
      stops: optimizedStops,
    }),
  };
}
