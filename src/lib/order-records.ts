import { randomBytes } from "crypto";
import type { DeliveryCheckResult } from "./delivery";
import type { CheckoutRequest, DeliveryAddress, MenuProduct, OrderStatus } from "./types";
import { getSupabaseAdminClient } from "./supabase";

type CheckoutOrderItem = MenuProduct & {
  quantity: number;
};

type CreatePendingOrderInput = {
  checkout: CheckoutRequest;
  deliveryCheck: DeliveryCheckResult;
  deliveryWindowId: string;
  items: CheckoutOrderItem[];
};

export type PendingOrder = {
  id: string;
  customerId: string;
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  orderSummary: string;
  checkoutCancelToken: string;
};

export type PaidOrderSummary = {
  orderId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  orderSummary: string;
  deliveryWindow: string;
  deliveryAddress: string;
  notes: string | null;
};

export type OrderConfirmation = {
  id: string;
  status: OrderStatus;
  customerName: string;
  customerEmail: string;
  orderSummary: string;
  deliveryWindow: string;
  deliveryAddress: string;
  deliveryInstructions: string | null;
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  paidAt: string | null;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function buildOrderSummary(items: CheckoutOrderItem[]) {
  return items.map((item) => `${item.quantity} x ${item.name}`).join("\n");
}

function buildCancelToken() {
  return randomBytes(24).toString("hex");
}

function formatAddress(address: DeliveryAddress) {
  return [
    address.line1,
    address.line2,
    `${address.city}, ${address.state} ${address.postalCode}`,
  ]
    .filter(Boolean)
    .join(", ");
}

export async function createPendingCheckoutOrder({
  checkout,
  deliveryCheck,
  deliveryWindowId,
  items,
}: CreatePendingOrderInput): Promise<PendingOrder> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new Error("Supabase admin client is not configured.");
  }

  const customerEmail = normalizeEmail(checkout.customer.email);
  const { data: existingCustomer, error: existingCustomerError } = await supabase
    .from("customers")
    .select("id")
    .eq("email", customerEmail)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingCustomerError) {
    throw new Error(existingCustomerError.message);
  }

  let customerId = existingCustomer?.id as string | undefined;
  if (customerId) {
    const { error } = await supabase
      .from("customers")
      .update({
        name: checkout.customer.name,
        phone: checkout.customer.phone,
      })
      .eq("id", customerId);

    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await supabase
      .from("customers")
      .insert({
        name: checkout.customer.name,
        email: customerEmail,
        phone: checkout.customer.phone,
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    customerId = data.id as string;
  }

  const subtotalCents = items.reduce(
    (sum, item) => sum + item.priceCents * item.quantity,
    0,
  );
  const deliveryFeeCents = deliveryCheck.feeCents;
  const totalCents = subtotalCents + deliveryFeeCents;
  const checkoutCancelToken = buildCancelToken();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      customer_id: customerId,
      delivery_window_id: deliveryWindowId,
      status: "pending_payment",
      subtotal_cents: subtotalCents,
      delivery_fee_cents: deliveryFeeCents,
      total_cents: totalCents,
      delivery_address: {
        ...checkout.address,
        email: customerEmail,
        phone: checkout.customer.phone,
      },
      delivery_miles: deliveryCheck.miles,
      delivery_instructions: checkout.deliveryInstructions || null,
      delivery_check: deliveryCheck,
      notes: checkout.notes || null,
      checkout_cancel_token: checkoutCancelToken,
    })
    .select("id")
    .single();

  if (orderError) throw new Error(orderError.message);

  const orderId = order.id as string;
  const { error: itemsError } = await supabase.from("order_items").insert(
    items.map((item) => ({
      order_id: orderId,
      product_id: item.id,
      quantity: item.quantity,
      unit_price_cents: item.priceCents,
    })),
  );

  if (itemsError) {
    await supabase.from("orders").delete().eq("id", orderId);
    throw new Error(itemsError.message);
  }

  const { error: reservationError } = await supabase.rpc("reserve_order_inventory", {
    p_delivery_window_id: deliveryWindowId,
    p_items: items.map((item) => ({
      product_id: item.id,
      quantity: item.quantity,
    })),
  });

  if (reservationError) {
    await supabase.from("orders").delete().eq("id", orderId);
    throw new Error(reservationError.message);
  }

  return {
    id: orderId,
    customerId,
    subtotalCents,
    deliveryFeeCents,
    totalCents,
    orderSummary: buildOrderSummary(items),
    checkoutCancelToken,
  };
}

export async function attachStripeSessionToOrder(orderId: string, sessionId: string) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { error } = await supabase
    .from("orders")
    .update({ stripe_checkout_session_id: sessionId })
    .eq("id", orderId);

  if (error) throw new Error(error.message);
}

export async function releasePendingOrder(orderId: string) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data: updatedOrders, error } = await supabase
    .from("orders")
    .update({
      status: "canceled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .eq("status", "pending_payment")
    .select("id");

  if (error) throw new Error(error.message);
  if (!updatedOrders?.[0]) return null;

  const { error: releaseError } = await supabase.rpc("release_order_inventory", {
    p_order_id: orderId,
  });
  if (releaseError) throw new Error(releaseError.message);
  return orderId;
}

export async function cancelPendingOrderByToken(orderId: string, token: string) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data: order, error: lookupError } = await supabase
    .from("orders")
    .select("id")
    .eq("id", orderId)
    .eq("checkout_cancel_token", token)
    .eq("status", "pending_payment")
    .maybeSingle();

  if (lookupError) throw new Error(lookupError.message);
  if (!order) return null;

  return releasePendingOrder(orderId);
}

export async function markCheckoutSessionPaid(
  sessionId: string,
): Promise<PaidOrderSummary | null> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data: updatedOrders, error } = await supabase
    .from("orders")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_checkout_session_id", sessionId)
    .eq("status", "pending_payment")
    .select("id, customer_id, delivery_window_id, delivery_address, notes");

  if (error) throw new Error(error.message);
  const order = updatedOrders?.[0];
  if (!order) return null;

  const [{ data: customer }, { data: deliveryWindow }, { data: orderItems }] =
    await Promise.all([
      supabase
        .from("customers")
        .select("name, email, phone")
        .eq("id", order.customer_id)
        .maybeSingle(),
      supabase
        .from("delivery_windows")
        .select("label")
        .eq("id", order.delivery_window_id)
        .maybeSingle(),
      supabase
        .from("order_items")
        .select("quantity, products(name)")
        .eq("order_id", order.id),
    ]);

  return {
    orderId: order.id as string,
    customerName: String(customer?.name || "there"),
    customerEmail: String(customer?.email || ""),
    customerPhone: String(customer?.phone || ""),
    orderSummary:
      orderItems
        ?.map((item) => {
          const product = Array.isArray(item.products)
            ? item.products[0]
            : item.products;
          return `${item.quantity} x ${product?.name || "Item"}`;
        })
        .join("\n") || "Order paid in Stripe Checkout",
    deliveryWindow: String(deliveryWindow?.label || "Selected window"),
    deliveryAddress: formatAddress(order.delivery_address as DeliveryAddress),
    notes: (order.notes as string | null) ?? null,
  };
}

export async function cancelExpiredCheckoutSession(sessionId: string) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data: updatedOrders, error } = await supabase
    .from("orders")
    .update({
      status: "canceled",
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_checkout_session_id", sessionId)
    .eq("status", "pending_payment")
    .select("id");

  if (error) throw new Error(error.message);

  const orderId = updatedOrders?.[0]?.id as string | undefined;
  if (!orderId) return null;

  const { error: releaseError } = await supabase.rpc("release_order_inventory", {
    p_order_id: orderId,
  });
  if (releaseError) throw new Error(releaseError.message);

  return orderId;
}

export async function getOrderConfirmationBySessionId(
  sessionId: string,
): Promise<OrderConfirmation | null> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return null;

  const { data: order, error } = await supabase
    .from("orders")
    .select(
      "id, customers(name, email), delivery_windows(label), status, subtotal_cents, delivery_fee_cents, total_cents, delivery_address, delivery_instructions, paid_at, order_items(quantity, unit_price_cents, products(name))",
    )
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();

  if (error) {
    console.error("[supabase] order confirmation lookup failed", error.message);
    return null;
  }

  if (!order) return null;
  const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers;
  const deliveryWindow = Array.isArray(order.delivery_windows)
    ? order.delivery_windows[0]
    : order.delivery_windows;
  const items = ((order.order_items || []) as Array<{
    quantity: number;
    products: { name: string } | { name: string }[] | null;
  }>)
    .map((item) => {
      const product = Array.isArray(item.products) ? item.products[0] : item.products;
      return `${item.quantity} x ${product?.name || "Item"}`;
    })
    .join("\n");

  return {
    id: order.id as string,
    status: order.status as OrderStatus,
    customerName: String(customer?.name || "there"),
    customerEmail: String(customer?.email || ""),
    orderSummary: items || "Order details unavailable",
    deliveryWindow: String(deliveryWindow?.label || "Selected window"),
    deliveryAddress: formatAddress(order.delivery_address as DeliveryAddress),
    deliveryInstructions: (order.delivery_instructions as string | null) ?? null,
    subtotalCents: Number(order.subtotal_cents || 0),
    deliveryFeeCents: Number(order.delivery_fee_cents || 0),
    totalCents: Number(order.total_cents || 0),
    paidAt: (order.paid_at as string | null) ?? null,
  };
}
