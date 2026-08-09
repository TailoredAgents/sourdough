import { randomBytes } from "crypto";
import type { DeliveryCheckResult } from "./delivery";
import type { CheckoutRequest, DeliveryAddress, MenuProduct, OrderStatus } from "./types";
import { getSupabaseAdminClient } from "./supabase";

type CheckoutOrderItem = MenuProduct & {
  quantity: number;
};

type CreatePendingOrderInput = {
  checkout: CheckoutRequest;
  checkoutRequestHash: string;
  deliveryCheck: DeliveryCheckResult;
  deliveryWindowId: string;
  items: CheckoutOrderItem[];
  approvalMode?: "standard" | "after_cutoff";
  reserveInventory?: boolean;
};

export type PendingOrder = {
  id: string;
  customerId: string;
  subtotalCents: number;
  deliveryFeeCents: number;
  taxCents: number;
  totalCents: number;
  orderSummary: string;
  checkoutCancelToken: string;
  checkoutExpiresAt: string;
  approvalMode: "standard" | "after_cutoff";
};

type CheckoutAttemptOrderRow = {
  id: string;
  customer_id: string;
  delivery_window_id: string;
  status: OrderStatus;
  subtotal_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  delivery_check: DeliveryCheckResult;
  checkout_cancel_token: string;
  checkout_request_hash: string;
  checkout_expires_at: string;
  stripe_checkout_session_id: string | null;
  approval_mode: "standard" | "after_cutoff";
};

type CheckoutAttemptProductRow = {
  id: string;
  name: string;
  category: MenuProduct["category"];
  description: string;
  ingredients: string[];
  allergens: string[];
  estimated_ingredient_cost_cents: number | null;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  stripe_price_cents: number | null;
  stripe_synced_at: string | null;
  image_url: string | null;
  image_style: string;
  active: boolean;
};

type CheckoutAttemptItemRow = {
  product_id: string;
  quantity: number;
  unit_price_cents: number;
  products: CheckoutAttemptProductRow | CheckoutAttemptProductRow[] | null;
};

export type ExistingCheckoutAttempt = {
  pendingOrder: PendingOrder;
  items: CheckoutOrderItem[];
  deliveryCheck: DeliveryCheckResult;
  deliveryWindowLabel: string;
  weeklyMenuId: string;
  status: OrderStatus;
  stripeCheckoutSessionId: string | null;
};

export type PaidOrderSummary = {
  orderId: string;
  status: OrderStatus;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  orderSummary: string;
  deliveryWindow: string;
  deliveryAddress: string;
  notes: string | null;
};

type PaidOrderRow = {
  id: string;
  customer_id: string;
  delivery_window_id: string;
  delivery_address: DeliveryAddress;
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
  taxCents: number;
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
  approvalMode = "standard",
  checkout,
  checkoutRequestHash,
  deliveryCheck,
  deliveryWindowId,
  items,
  reserveInventory = true,
}: CreatePendingOrderInput): Promise<PendingOrder> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new Error("Supabase admin client is not configured.");
  }

  const customerEmail = normalizeEmail(checkout.customer.email);
  const checkoutCancelToken = buildCancelToken();
  const { data, error } = await supabase.rpc(
    "create_storefront_checkout_order",
    {
      p_checkout_attempt_id: checkout.checkoutAttemptId,
      p_checkout_request_hash: checkoutRequestHash,
      p_customer_name: checkout.customer.name,
      p_customer_email: customerEmail,
      p_customer_phone: checkout.customer.phone || null,
      p_delivery_window_id: deliveryWindowId,
      p_approval_mode: approvalMode,
      p_delivery_address: {
        ...checkout.address,
        name: checkout.customer.name.trim(),
        email: customerEmail,
        phone: checkout.customer.phone,
      },
      p_delivery_miles: deliveryCheck.miles,
      p_delivery_instructions: checkout.deliveryInstructions || null,
      p_delivery_check: deliveryCheck,
      p_delivery_fee_cents: deliveryCheck.feeCents,
      p_notes: checkout.notes || null,
      p_next_week_ok:
        approvalMode === "after_cutoff" ? Boolean(checkout.nextWeekOk) : null,
      p_checkout_cancel_token: checkoutCancelToken,
      p_items: items.map((item) => ({
        product_id: item.id,
        quantity: item.quantity,
        unit_price_cents: item.priceCents,
      })),
      p_reserve_inventory: reserveInventory,
    },
  );
  if (error) throw new Error(error.message);

  const result = Array.isArray(data) ? data[0] : data;
  if (
    !result?.order_id ||
    !result.customer_id ||
    typeof result.subtotal_cents !== "number" ||
    typeof result.delivery_fee_cents !== "number" ||
    typeof result.total_cents !== "number" ||
    typeof result.checkout_cancel_token !== "string" ||
    typeof result.checkout_expires_at !== "string"
  ) {
    throw new Error("Checkout order command returned an invalid result.");
  }

  return {
    id: String(result.order_id),
    customerId: String(result.customer_id),
    subtotalCents: result.subtotal_cents,
    deliveryFeeCents: result.delivery_fee_cents,
    taxCents: 0,
    totalCents: result.total_cents,
    orderSummary: buildOrderSummary(items),
    checkoutCancelToken: result.checkout_cancel_token,
    checkoutExpiresAt: result.checkout_expires_at,
    approvalMode,
  };
}

export async function getExistingCheckoutAttempt(
  checkoutAttemptId: string,
  checkoutRequestHash: string,
): Promise<ExistingCheckoutAttempt | null> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data: orderData, error: orderError } = await supabase
    .from("orders")
    .select(
      "id, customer_id, delivery_window_id, status, subtotal_cents, delivery_fee_cents, total_cents, delivery_check, checkout_cancel_token, checkout_request_hash, checkout_expires_at, stripe_checkout_session_id, approval_mode",
    )
    .eq("checkout_attempt_id", checkoutAttemptId)
    .maybeSingle();
  if (orderError) throw new Error(orderError.message);
  if (!orderData) return null;

  const order = orderData as CheckoutAttemptOrderRow;
  if (order.checkout_request_hash !== checkoutRequestHash) {
    throw new Error("Checkout attempt was already used with different order details.");
  }

  const [itemResult, windowResult] = await Promise.all([
    supabase
      .from("order_items")
      .select(
        "product_id, quantity, unit_price_cents, products(id, name, category, description, ingredients, allergens, estimated_ingredient_cost_cents, stripe_product_id, stripe_price_id, stripe_price_cents, stripe_synced_at, image_url, image_style, active)",
      )
      .eq("order_id", order.id),
    supabase
      .from("delivery_windows")
      .select("label, weekly_menu_id")
      .eq("id", order.delivery_window_id)
      .maybeSingle(),
  ]);
  if (itemResult.error) throw new Error(itemResult.error.message);
  if (windowResult.error) throw new Error(windowResult.error.message);
  if (!windowResult.data) throw new Error("Checkout delivery window could not be found.");

  const items = ((itemResult.data || []) as CheckoutAttemptItemRow[]).map(
    (item) => {
      const product = Array.isArray(item.products)
        ? item.products[0]
        : item.products;
      if (!product) throw new Error("Checkout product could not be found.");
      return {
        id: product.id,
        productId: product.id,
        name: product.name,
        category: product.category,
        description: product.description,
        ingredients: product.ingredients,
        allergens: product.allergens,
        priceCents: item.unit_price_cents,
        estimatedIngredientCostCents:
          product.estimated_ingredient_cost_cents,
        stripeProductId: product.stripe_product_id,
        stripePriceId: product.stripe_price_id,
        stripePriceCents: product.stripe_price_cents,
        stripeSyncedAt: product.stripe_synced_at,
        imageUrl: product.image_url,
        imageStyle: product.image_style,
        active: product.active,
        availableQuantity: item.quantity,
        soldQuantity: item.quantity,
        remainingQuantity: 0,
        featured: false,
        unavailable: false,
        quantity: item.quantity,
      } satisfies CheckoutOrderItem;
    },
  );
  if (!items.length) throw new Error("Checkout order has no items.");

  const orderSummary = buildOrderSummary(items);
  return {
    pendingOrder: {
      id: order.id,
      customerId: order.customer_id,
      subtotalCents: order.subtotal_cents,
      deliveryFeeCents: order.delivery_fee_cents,
      taxCents: 0,
      totalCents: order.total_cents,
      orderSummary,
      checkoutCancelToken: order.checkout_cancel_token,
      checkoutExpiresAt: order.checkout_expires_at,
      approvalMode: order.approval_mode,
    },
    items,
    deliveryCheck: order.delivery_check,
    deliveryWindowLabel: String(windowResult.data.label),
    weeklyMenuId: String(windowResult.data.weekly_menu_id),
    status: order.status,
    stripeCheckoutSessionId: order.stripe_checkout_session_id,
  };
}

export async function attachStripeSessionToOrder(orderId: string, sessionId: string) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data, error } = await supabase.rpc(
    "attach_storefront_checkout_session",
    {
      p_order_id: orderId,
      p_session_id: sessionId,
    },
  );

  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("Storefront order could not be attached to Stripe Checkout.");
}

export async function releasePendingOrder(orderId: string, sessionId?: string) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { data, error } = await supabase.rpc("cancel_storefront_checkout", {
    p_order_id: orderId,
    p_session_id: sessionId || null,
    p_cancel_token: null,
    p_actor_email: null,
    p_reason: "Checkout setup failed or was abandoned.",
  });
  if (error) throw new Error(error.message);
  return data ? String(data) : null;
}

export async function getPendingCheckoutCancellationSession(
  orderId: string,
  token: string,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { data, error } = await supabase
    .from("orders")
    .select("stripe_checkout_session_id")
    .eq("id", orderId)
    .eq("checkout_cancel_token", token)
    .eq("source", "storefront")
    .in("status", ["pending_payment", "pending_approval_payment"])
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.stripe_checkout_session_id
    ? String(data.stripe_checkout_session_id)
    : null;
}

export async function cancelPendingOrderByToken(
  orderId: string,
  token: string,
  sessionId: string,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { data, error } = await supabase.rpc("cancel_storefront_checkout", {
    p_order_id: orderId,
    p_session_id: sessionId,
    p_cancel_token: token,
    p_actor_email: null,
    p_reason: "Customer left Stripe Checkout before payment.",
  });
  if (error) throw new Error(error.message);
  return data ? String(data) : null;
}

async function hydratePaidOrderSummary(
  order: PaidOrderRow,
  status: OrderStatus,
): Promise<PaidOrderSummary> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const [customerResult, deliveryWindowResult, orderItemsResult] =
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

  if (customerResult.error) throw new Error(customerResult.error.message);
  if (deliveryWindowResult.error) {
    throw new Error(deliveryWindowResult.error.message);
  }
  if (orderItemsResult.error) throw new Error(orderItemsResult.error.message);

  return {
    orderId: order.id,
    customerName: String(customerResult.data?.name || "there"),
    customerEmail: String(customerResult.data?.email || ""),
    customerPhone: String(customerResult.data?.phone || ""),
    orderSummary:
      orderItemsResult.data
        ?.map((item) => {
          const product = Array.isArray(item.products)
            ? item.products[0]
            : item.products;
          return `${item.quantity} x ${product?.name || "Item"}`;
        })
        .join("\n") || "Order paid in Stripe Checkout",
    deliveryWindow: String(
      deliveryWindowResult.data?.label || "Selected window",
    ),
    deliveryAddress: formatAddress(order.delivery_address),
    notes: order.notes,
    status,
  };
}

export async function getPaidCheckoutOrderSummaryBySessionId(
  sessionId: string,
): Promise<PaidOrderSummary | null> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data: order, error } = await supabase
    .from("orders")
    .select(
      "id, customer_id, delivery_window_id, delivery_address, notes, status",
    )
    .eq("stripe_checkout_session_id", sessionId)
    .in("status", ["paid", "pending_approval"])
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!order) return null;

  return hydratePaidOrderSummary(
    order as PaidOrderRow,
    order.status as OrderStatus,
  );
}

export async function markCheckoutSessionPaid(
  sessionId: string,
  payment?: {
    currency?: string | null;
    subtotalCents?: number | null;
    taxCents?: number | null;
    totalCents?: number | null;
  },
): Promise<PaidOrderSummary | null> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  if (
    !payment?.currency ||
    typeof payment.subtotalCents !== "number" ||
    typeof payment.taxCents !== "number" ||
    typeof payment.totalCents !== "number"
  ) {
    throw new Error("Stripe Checkout payment totals are incomplete.");
  }

  const { data, error } = await supabase.rpc(
    "complete_storefront_checkout_payment",
    {
      p_session_id: sessionId,
      p_currency: payment.currency,
      p_subtotal_cents: payment.subtotalCents,
      p_tax_cents: payment.taxCents,
      p_total_cents: payment.totalCents,
    },
  );
  if (error) throw new Error(error.message);
  const result = Array.isArray(data) ? data[0] : data;
  if (!result || !["paid", "pending_approval"].includes(result.next_status)) {
    return null;
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, customer_id, delivery_window_id, delivery_address, notes")
    .eq("id", result.order_id)
    .maybeSingle();
  if (orderError) throw new Error(orderError.message);
  if (!order) return null;

  return hydratePaidOrderSummary(
    order as PaidOrderRow,
    result.next_status as OrderStatus,
  );
}

export async function cancelExpiredCheckoutSession(
  sessionId: string,
  recoveryOrderId?: string,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  if (recoveryOrderId) {
    await attachStripeSessionToOrder(recoveryOrderId, sessionId);
  }
  const { data, error } = await supabase.rpc("cancel_storefront_checkout", {
    p_order_id: recoveryOrderId || null,
    p_session_id: sessionId,
    p_cancel_token: null,
    p_actor_email: null,
    p_reason: "Stripe Checkout expired or payment failed.",
  });
  if (error) throw new Error(error.message);
  return data ? String(data) : null;
}

export async function cleanupAbandonedStorefrontCheckouts() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { data, error } = await supabase.rpc(
    "cleanup_abandoned_storefront_checkouts",
  );
  if (error) throw new Error(error.message);
  const canceled = Number(data);
  return Number.isSafeInteger(canceled) && canceled >= 0 ? canceled : 0;
}

export async function getOrderConfirmationBySessionId(
  sessionId: string,
): Promise<OrderConfirmation | null> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return null;

  const { data: order, error } = await supabase
    .from("orders")
    .select(
      "id, customers(name, email), delivery_windows(label), status, subtotal_cents, delivery_fee_cents, tax_cents, total_cents, delivery_address, delivery_instructions, paid_at, order_items(quantity, unit_price_cents, products(name))",
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
    taxCents: Number(order.tax_cents || 0),
    totalCents: Number(order.total_cents || 0),
    paidAt: (order.paid_at as string | null) ?? null,
  };
}
