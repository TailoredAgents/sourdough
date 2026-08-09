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
  orderIds: string[];
  customerName: string;
  customerPhone: string | null;
  customerContacts: Array<{ name: string; phone: string | null }>;
  address: string;
  orderSummary: string;
  notes: string | null;
  deliveryInstructions: string | null;
};

export type AdminSundayRoute = {
  weeklyMenuId: string | null;
  weeklyMenuName: string | null;
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

export function getSundayRouteCandidateOrders(
  orders: AdminOrder[],
  weeklyMenuId?: string | null,
) {
  return orders.filter(
    (order) =>
      routeStatuses.has(order.status) &&
      (!weeklyMenuId || order.weeklyMenuId === weeklyMenuId),
  );
}

export async function buildAdminSundayRoute(
  orders: AdminOrder[],
  weeklyMenuId?: string | null,
  weeklyMenuName?: string | null,
): Promise<AdminSundayRoute> {
  const originAddress = getDeliveryOriginAddress();
  const destinationAddress = getDeliveryRouteEndAddress();
  const candidateOrders = getSundayRouteCandidateOrders(orders, weeklyMenuId);
  const routeWeekId = weeklyMenuId || candidateOrders[0]?.weeklyMenuId || null;
  const routeWeekName =
    weeklyMenuName || candidateOrders[0]?.weeklyMenuName || null;
  const stopsByAddress = new Map<string, AdminRouteStop>();
  for (const order of candidateOrders) {
    const address = formatDeliveryAddress(order.deliveryAddress);
    const key = address.trim().toLowerCase();
    const existing = stopsByAddress.get(key);
    if (!existing) {
      stopsByAddress.set(key, {
        orderId: order.id,
        orderIds: [order.id],
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        customerContacts: [
          { name: order.customerName, phone: order.customerPhone },
        ],
        address,
        orderSummary: orderSummary(order),
        notes: order.notes,
        deliveryInstructions: order.deliveryInstructions,
      });
      continue;
    }

    existing.orderIds.push(order.id);
    if (
      !existing.customerContacts.some(
        (contact) =>
          contact.name === order.customerName &&
          contact.phone === order.customerPhone,
      )
    ) {
      existing.customerContacts.push({
        name: order.customerName,
        phone: order.customerPhone,
      });
    }
    existing.customerName = existing.customerContacts
      .map((contact) => contact.name)
      .join(" / ");
    existing.customerPhone =
      existing.customerContacts.find((contact) => contact.phone)?.phone ?? null;
    existing.orderSummary = [existing.orderSummary, orderSummary(order)]
      .filter(Boolean)
      .join("; ");
    existing.notes = [existing.notes, order.notes].filter(Boolean).join(" | ") || null;
    existing.deliveryInstructions = [
      existing.deliveryInstructions,
      order.deliveryInstructions,
    ].filter(Boolean).join(" | ") || null;
  }
  const stops = Array.from(stopsByAddress.values());

  if (!stops.length) {
    return {
      weeklyMenuId: routeWeekId,
      weeklyMenuName: routeWeekName,
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
    weeklyMenuId: routeWeekId,
    weeklyMenuName: routeWeekName,
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
