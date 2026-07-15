import { z } from "zod";
import type { AdminOrder, AdminOrderItem, DeliveryAddress, OrderStatus } from "./types";
import { sendOrderStatusUpdate } from "./email";
import { getCustomerOrderStatusLabel } from "./order-status";
import { getSupabaseAdminClient } from "./supabase";

type OrderCustomerRow = {
  name: string;
  email: string;
  phone: string | null;
};

type OrderDeliveryWindowRow = {
  label: string;
};

type OrderRow = {
  id: string;
  delivery_window_id: string | null;
  customers: OrderCustomerRow | OrderCustomerRow[] | null;
  delivery_windows: OrderDeliveryWindowRow | OrderDeliveryWindowRow[] | null;
  status: OrderStatus;
  stripe_checkout_session_id: string | null;
  subtotal_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  delivery_address: DeliveryAddress & {
    email?: string;
    phone?: string;
  };
  delivery_miles: number | string | null;
  delivery_instructions: string | null;
  delivery_check: Record<string, unknown> | null;
  notes: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
  checkout_cancel_token: string | null;
};

type ProductNameRow = {
  name: string;
};

type OrderItemRow = {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price_cents: number;
  products: ProductNameRow | ProductNameRow[] | null;
};

const orderStatusSchema = z.enum([
  "draft",
  "pending_payment",
  "paid",
  "baking",
  "out_for_delivery",
  "delivered",
  "canceled",
]);

export const orderStatusUpdateSchema = z.object({
  id: z.string().uuid(),
  status: orderStatusSchema,
});

export const orderStatuses = orderStatusSchema.options;

const reservedOrderStatuses = new Set<OrderStatus>([
  "pending_payment",
  "paid",
  "baking",
  "out_for_delivery",
]);
const paidOrderStatuses = new Set<OrderStatus>([
  "paid",
  "baking",
  "out_for_delivery",
  "delivered",
]);

export type AdminOrderInventoryAdjustment = "reserve" | "release" | null;

export function getAdminOrderInventoryAdjustment(
  previousStatus: OrderStatus | null | undefined,
  nextStatus: OrderStatus,
): AdminOrderInventoryAdjustment {
  if (!previousStatus || previousStatus === nextStatus) return null;
  if (reservedOrderStatuses.has(previousStatus) && nextStatus === "canceled") {
    return "release";
  }
  if (previousStatus === "canceled" && reservedOrderStatuses.has(nextStatus)) {
    return "reserve";
  }
  return null;
}

function single<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function mapOrderItem(row: OrderItemRow): AdminOrderItem {
  const product = single(row.products);
  return {
    id: row.id,
    productId: row.product_id,
    productName: product?.name || "Item",
    quantity: row.quantity,
    unitPriceCents: row.unit_price_cents,
  };
}

function mapOrder(row: OrderRow, items: AdminOrderItem[]): AdminOrder {
  const customer = single(row.customers);
  const deliveryWindow = single(row.delivery_windows);
  return {
    id: row.id,
    customerName: customer?.name || "Unknown customer",
    customerEmail: customer?.email || row.delivery_address.email || "",
    customerPhone: customer?.phone || row.delivery_address.phone || null,
    deliveryWindowLabel: deliveryWindow?.label || null,
    status: row.status,
    subtotalCents: row.subtotal_cents,
    deliveryFeeCents: row.delivery_fee_cents,
    totalCents: row.total_cents,
    deliveryAddress: row.delivery_address,
    deliveryMiles:
      row.delivery_miles === null || row.delivery_miles === undefined
        ? null
        : Number(row.delivery_miles),
    deliveryInstructions: row.delivery_instructions,
    deliveryCheck: row.delivery_check,
    notes: row.notes,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stripeCheckoutSessionId: row.stripe_checkout_session_id,
    checkoutCancelToken: row.checkout_cancel_token,
    items,
  };
}

export async function getAdminOrdersData(): Promise<AdminOrder[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return [];

  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select(
      "id, customers(name, email, phone), delivery_windows(label), status, stripe_checkout_session_id, subtotal_cents, delivery_fee_cents, total_cents, delivery_address, delivery_miles, delivery_instructions, delivery_check, notes, paid_at, created_at, updated_at, checkout_cancel_token",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (ordersError) {
    console.error("[supabase] admin orders lookup failed", ordersError.message);
    return [];
  }

  const orderRows = (orders as OrderRow[]) || [];
  const orderIds = orderRows.map((order) => order.id);
  if (!orderIds.length) return [];

  const { data: orderItems, error: itemsError } = await supabase
    .from("order_items")
    .select("id, order_id, product_id, quantity, unit_price_cents, products(name)")
    .in("order_id", orderIds)
    .order("id", { ascending: true });

  if (itemsError) {
    console.error("[supabase] admin order items lookup failed", itemsError.message);
    return orderRows.map((order) => mapOrder(order, []));
  }

  const itemsByOrderId = new Map<string, AdminOrderItem[]>();
  for (const item of (orderItems as OrderItemRow[]) || []) {
    const existing = itemsByOrderId.get(item.order_id) || [];
    existing.push(mapOrderItem(item));
    itemsByOrderId.set(item.order_id, existing);
  }

  return orderRows.map((order) => mapOrder(order, itemsByOrderId.get(order.id) || []));
}

export async function updateAdminOrderStatus(id: string, status: OrderStatus) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data: existingOrder, error: existingOrderError } = await supabase
    .from("orders")
    .select("status, paid_at, delivery_window_id")
    .eq("id", id)
    .maybeSingle();

  if (existingOrderError) throw new Error(existingOrderError.message);
  if (!existingOrder) throw new Error("Order could not be found.");

  const existingStatus = existingOrder.status as OrderStatus;
  const inventoryAdjustment = getAdminOrderInventoryAdjustment(existingStatus, status);
  const timestamp = new Date().toISOString();
  let inventoryWasReserved = false;

  if (inventoryAdjustment === "reserve") {
    if (!existingOrder.delivery_window_id) {
      throw new Error("Order does not have a delivery window to restore inventory.");
    }

    const { data: itemRows, error: itemError } = await supabase
      .from("order_items")
      .select("product_id, quantity")
      .eq("order_id", id);

    if (itemError) throw new Error(itemError.message);

    const { error: reserveError } = await supabase.rpc("reserve_order_inventory", {
      p_delivery_window_id: existingOrder.delivery_window_id,
      p_items: ((itemRows as Array<{ product_id: string; quantity: number }>) || []).map(
        (item) => ({
          product_id: item.product_id,
          quantity: item.quantity,
        }),
      ),
    });

    if (reserveError) throw new Error(reserveError.message);
    inventoryWasReserved = true;
  }

  const updatePayload: {
    status: OrderStatus;
    updated_at: string;
    paid_at?: string;
  } = {
    status,
    updated_at: timestamp,
  };

  if (paidOrderStatuses.has(status) && !existingOrder.paid_at) {
    updatePayload.paid_at = timestamp;
  }

  const { error } = await supabase.from("orders").update(updatePayload).eq("id", id);

  if (error) {
    if (inventoryWasReserved) {
      await supabase.rpc("release_order_inventory", { p_order_id: id });
    }
    throw new Error(error.message);
  }

  if (inventoryAdjustment === "release") {
    const { error: releaseError } = await supabase.rpc("release_order_inventory", {
      p_order_id: id,
    });
    if (releaseError) {
      await supabase
        .from("orders")
        .update({
          status: existingStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      throw new Error(releaseError.message);
    }
  }

  const orders = await getAdminOrdersData();
  const updatedOrder = orders.find((order) => order.id === id);
  if (updatedOrder && existingStatus !== status && updatedOrder.customerEmail) {
    try {
      await sendOrderStatusUpdate({
        to: updatedOrder.customerEmail,
        customerName: updatedOrder.customerName,
        orderSummary: updatedOrder.items
          .map((item) => `${item.quantity} x ${item.productName}`)
          .join("\n"),
        deliveryWindow: updatedOrder.deliveryWindowLabel || "Selected window",
        orderId: updatedOrder.id,
        statusLabel: getCustomerOrderStatusLabel(status),
      });
    } catch (emailError) {
      console.error("[orders] status email failed", emailError);
    }
  }

  return orders;
}
