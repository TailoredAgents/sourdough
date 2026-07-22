import { z } from "zod";
import type {
  AdminOrder,
  AdminOrderItem,
  AdminOrderMoveWindow,
  DeliveryAddress,
  OrderStatus,
} from "./types";
import { sendOrderStatusUpdate } from "./email";
import { isStandardSundayDeliveryWindow } from "./bake-schedule";
import { getCustomerOrderStatusLabel } from "./order-status";
import { getStripe } from "./stripe";
import { getSupabaseAdminClient } from "./supabase";

type OrderCustomerRow = {
  name: string;
  email: string;
  phone: string | null;
};

type OrderDeliveryWindowRow = {
  label: string;
  weekly_menu_id: string | null;
  weekly_menus:
    | {
        name: string;
        starts_at: string;
      }
    | Array<{
        name: string;
        starts_at: string;
      }>
    | null;
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
  next_week_ok: boolean | null;
  approval_mode: string | null;
  approved_at: string | null;
  denied_at: string | null;
  refunded_at: string | null;
  stripe_refund_id: string | null;
  admin_decision_note: string | null;
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
  "pending_approval_payment",
  "pending_approval",
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

export const orderApprovalActionSchema = z.discriminatedUnion("action", [
  z.object({
    id: z.string().uuid(),
    action: z.literal("accept_request"),
  }),
  z.object({
    id: z.string().uuid(),
    action: z.literal("deny_refund"),
  }),
  z.object({
    id: z.string().uuid(),
    action: z.literal("move_to_next_week"),
    targetDeliveryWindowId: z.string().uuid(),
  }),
]);

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

function mapOrder(
  row: OrderRow,
  items: AdminOrderItem[],
  moveWindows: AdminOrderMoveWindow[] = [],
): AdminOrder {
  const customer = single(row.customers);
  const deliveryWindow = single(row.delivery_windows);
  const weeklyMenu = single(deliveryWindow?.weekly_menus || null);
  return {
    id: row.id,
    customerName: customer?.name || "Unknown customer",
    customerEmail: customer?.email || row.delivery_address.email || "",
    customerPhone: customer?.phone || row.delivery_address.phone || null,
    weeklyMenuId: deliveryWindow?.weekly_menu_id || null,
    weeklyMenuName: weeklyMenu?.name || null,
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
    nextWeekOk: row.next_week_ok,
    approvalMode: row.approval_mode,
    approvedAt: row.approved_at,
    deniedAt: row.denied_at,
    refundedAt: row.refunded_at,
    stripeRefundId: row.stripe_refund_id,
    adminDecisionNote: row.admin_decision_note,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stripeCheckoutSessionId: row.stripe_checkout_session_id,
    checkoutCancelToken: row.checkout_cancel_token,
    items,
    moveWindows,
  };
}

export async function getAdminOrdersData(): Promise<AdminOrder[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return [];

  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select(
      "id, customers(name, email, phone), delivery_windows(label, weekly_menu_id, weekly_menus(name, starts_at)), status, stripe_checkout_session_id, subtotal_cents, delivery_fee_cents, total_cents, delivery_address, delivery_miles, delivery_instructions, delivery_check, notes, next_week_ok, approval_mode, approved_at, denied_at, refunded_at, stripe_refund_id, admin_decision_note, paid_at, created_at, updated_at, checkout_cancel_token",
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

  const moveWindowsByOrderId = await getMoveWindowsByOrderId(orderRows);

  return orderRows.map((order) =>
    mapOrder(
      order,
      itemsByOrderId.get(order.id) || [],
      moveWindowsByOrderId.get(order.id) || [],
    ),
  );
}

async function getMoveWindowsByOrderId(orderRows: OrderRow[]) {
  const supabase = getSupabaseAdminClient();
  const result = new Map<string, AdminOrderMoveWindow[]>();
  if (!supabase) return result;

  for (const order of orderRows) {
    if (order.status !== "pending_approval" || !order.next_week_ok) continue;
    const deliveryWindow = single(order.delivery_windows);
    const currentWeeklyMenu = single(deliveryWindow?.weekly_menus || null);
    if (!currentWeeklyMenu?.starts_at) continue;

    const { data: nextMenu, error: nextMenuError } = await supabase
      .from("weekly_menus")
      .select("id, name, starts_at")
      .eq("published", true)
      .gt("starts_at", currentWeeklyMenu.starts_at)
      .order("starts_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (nextMenuError || !nextMenu) continue;

    const { data: windows, error: windowsError } = await supabase
      .from("delivery_windows")
      .select("id, label, weekly_menu_id, starts_at, ends_at, capacity, reserved")
      .eq("weekly_menu_id", nextMenu.id)
      .order("starts_at", { ascending: true });
    if (windowsError) continue;

    result.set(
      order.id,
      ((windows || []) as Array<{
        id: string;
        label: string;
        weekly_menu_id: string;
        starts_at: string;
        ends_at: string;
        capacity: number;
        reserved: number;
      }>)
        .filter(
          (window) =>
            window.reserved < window.capacity &&
            isStandardSundayDeliveryWindow(window.starts_at, window.ends_at),
        )
        .map((window) => ({
          id: window.id,
          label: window.label,
          weeklyMenuId: window.weekly_menu_id,
          weeklyMenuName: String(nextMenu.name || "Next delivery week"),
          startsAt: window.starts_at,
          capacity: window.capacity,
          reserved: window.reserved,
        })),
    );
  }

  return result;
}

async function reserveInventoryForOrder(orderId: string, deliveryWindowId: string) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data: itemRows, error: itemError } = await supabase
    .from("order_items")
    .select("product_id, quantity")
    .eq("order_id", orderId);

  if (itemError) throw new Error(itemError.message);

  const { error: reserveError } = await supabase.rpc("reserve_order_inventory", {
    p_delivery_window_id: deliveryWindowId,
    p_items: ((itemRows as Array<{ product_id: string; quantity: number }>) || []).map(
      (item) => ({
        product_id: item.product_id,
        quantity: item.quantity,
      }),
    ),
  });

  if (reserveError) throw new Error(reserveError.message);
}

async function releaseInventoryForWindowItems(orderId: string, deliveryWindowId: string) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data: window, error: windowError } = await supabase
    .from("delivery_windows")
    .select("weekly_menu_id")
    .eq("id", deliveryWindowId)
    .maybeSingle();
  if (windowError || !window?.weekly_menu_id) return;

  const { data: itemRows } = await supabase
    .from("order_items")
    .select("product_id, quantity")
    .eq("order_id", orderId);

  const { data: targetWindow } = await supabase
    .from("delivery_windows")
    .select("reserved")
    .eq("id", deliveryWindowId)
    .maybeSingle();
  await supabase
    .from("delivery_windows")
    .update({ reserved: Math.max(Number(targetWindow?.reserved || 0) - 1, 0) })
    .eq("id", deliveryWindowId);

  for (const item of (itemRows as Array<{ product_id: string; quantity: number }>) || []) {
    const { data: menuItem } = await supabase
      .from("weekly_menu_items")
      .select("sold_quantity")
      .eq("weekly_menu_id", window.weekly_menu_id)
      .eq("product_id", item.product_id)
      .maybeSingle();
    await supabase
      .from("weekly_menu_items")
      .update({
        sold_quantity: Math.max(Number(menuItem?.sold_quantity || 0) - item.quantity, 0),
      })
      .eq("weekly_menu_id", window.weekly_menu_id)
      .eq("product_id", item.product_id);
  }
}

async function sendUpdatedOrderStatusEmail(orderId: string, status: OrderStatus) {
  const orders = await getAdminOrdersData();
  const updatedOrder = orders.find((order) => order.id === orderId);
  if (!updatedOrder?.customerEmail) return orders;

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

  return orders;
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
      throw new Error("Order does not have a Sunday delivery time to restore inventory.");
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

export async function acceptApprovalOrder(id: string) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data: order, error: lookupError } = await supabase
    .from("orders")
    .select("id, status, delivery_window_id")
    .eq("id", id)
    .maybeSingle();

  if (lookupError) throw new Error(lookupError.message);
  if (!order) throw new Error("Order could not be found.");
  if (order.status !== "pending_approval") {
    throw new Error("Only paid approval requests can be accepted.");
  }
  if (!order.delivery_window_id) {
    throw new Error("Order does not have a Sunday delivery time to reserve.");
  }

  await reserveInventoryForOrder(id, order.delivery_window_id as string);
  const { error } = await supabase
    .from("orders")
    .update({
      status: "paid",
      approved_at: new Date().toISOString(),
      admin_decision_note: "Accepted same-week approval request.",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    await releaseInventoryForWindowItems(id, order.delivery_window_id as string);
    throw new Error(error.message);
  }

  return sendUpdatedOrderStatusEmail(id, "paid");
}

export async function moveApprovalOrderToNextWeek(
  id: string,
  targetDeliveryWindowId: string,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data: order, error: lookupError } = await supabase
    .from("orders")
    .select("id, status, next_week_ok, delivery_windows(weekly_menus(starts_at))")
    .eq("id", id)
    .maybeSingle();

  if (lookupError) throw new Error(lookupError.message);
  if (!order) throw new Error("Order could not be found.");
  if (order.status !== "pending_approval") {
    throw new Error("Only paid approval requests can be moved.");
  }
  if (!order.next_week_ok) {
    throw new Error("Customer did not approve moving this order to next Sunday.");
  }

  const currentWindow = single(order.delivery_windows as OrderDeliveryWindowRow | OrderDeliveryWindowRow[] | null);
  const currentMenu = single(currentWindow?.weekly_menus || null);
  const { data: targetWindow, error: targetWindowError } = await supabase
    .from("delivery_windows")
    .select("id, starts_at, ends_at, weekly_menus(starts_at)")
    .eq("id", targetDeliveryWindowId)
    .maybeSingle();
  if (targetWindowError) throw new Error(targetWindowError.message);
  if (!targetWindow) throw new Error("Target Sunday delivery time could not be found.");

  const targetMenu = single(
    targetWindow.weekly_menus as { starts_at: string } | Array<{ starts_at: string }> | null,
  );
  if (
    !currentMenu?.starts_at ||
    !targetMenu?.starts_at ||
    new Date(targetMenu.starts_at).getTime() <= new Date(currentMenu.starts_at).getTime()
  ) {
    throw new Error("Move target must be a later delivery week.");
  }
  if (
    !isStandardSundayDeliveryWindow(
      String(targetWindow.starts_at || ""),
      String(targetWindow.ends_at || ""),
    )
  ) {
    throw new Error("Move target must be the Sunday 3:00-6:00 PM delivery slot.");
  }

  await reserveInventoryForOrder(id, targetDeliveryWindowId);
  const { error } = await supabase
    .from("orders")
    .update({
      delivery_window_id: targetDeliveryWindowId,
      status: "paid",
      approved_at: new Date().toISOString(),
      admin_decision_note: "Moved approval request to next delivery week.",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    await releaseInventoryForWindowItems(id, targetDeliveryWindowId);
    throw new Error(error.message);
  }

  return sendUpdatedOrderStatusEmail(id, "paid");
}

export async function denyApprovalOrderWithRefund(id: string) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data: order, error: lookupError } = await supabase
    .from("orders")
    .select("id, status, stripe_checkout_session_id")
    .eq("id", id)
    .maybeSingle();

  if (lookupError) throw new Error(lookupError.message);
  if (!order) throw new Error("Order could not be found.");
  if (order.status !== "pending_approval") {
    throw new Error("Only paid approval requests can be denied and refunded.");
  }
  if (!order.stripe_checkout_session_id) {
    throw new Error("Order does not have a Stripe Checkout session to refund.");
  }

  const stripe = getStripe();
  if (!stripe) throw new Error("Stripe is not configured for refunds.");

  const session = await stripe.checkout.sessions.retrieve(
    String(order.stripe_checkout_session_id),
  );
  const paymentIntent =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  if (!paymentIntent) {
    throw new Error("Stripe payment intent could not be found for this order.");
  }

  const refund = await stripe.refunds.create({
    payment_intent: paymentIntent,
    metadata: {
      order_id: id,
      reason: "after_cutoff_approval_denied",
    },
  });

  const { error } = await supabase
    .from("orders")
    .update({
      status: "canceled",
      denied_at: new Date().toISOString(),
      refunded_at: new Date().toISOString(),
      stripe_refund_id: refund.id,
      admin_decision_note: "Denied approval request and refunded payment.",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  return sendUpdatedOrderStatusEmail(id, "canceled");
}
