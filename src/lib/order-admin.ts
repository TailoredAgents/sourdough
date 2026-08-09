import { z } from "zod";
import type {
  AdminOrder,
  AdminOrderItem,
  AdminOrderMoveWindow,
  DeliveryAddress,
  OrderStatus,
} from "./types";
import { sendOrderStatusUpdate } from "./email";
import { getCustomerOrderStatusLabel } from "./order-status";
import { isAdminOrderTransitionAllowed } from "./admin-order-workflow";
import { isStandardSundayDeliveryWindow } from "./bake-schedule";
import { processOrderCompletionNotification } from "./order-notifications";
import { completeStorefrontCheckoutSession } from "./order-payment";
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
  source: "storefront" | "bread_club" | "bread_club_addon";
  bread_club_membership_id: string | null;
  bread_club_fulfillment_id: string | null;
  stripe_invoice_id: string | null;
  delivery_window_id: string | null;
  customers: OrderCustomerRow | OrderCustomerRow[] | null;
  delivery_windows: OrderDeliveryWindowRow | OrderDeliveryWindowRow[] | null;
  status: OrderStatus;
  stripe_checkout_session_id: string | null;
  subtotal_cents: number;
  delivery_fee_cents: number;
  tax_cents: number;
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
  approval_refund_started_at: string | null;
  admin_decision_note: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
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
    source: row.source,
    membershipId: row.bread_club_membership_id,
    breadClubFulfillmentId: row.bread_club_fulfillment_id,
    stripeInvoiceId: row.stripe_invoice_id,
    customerName: customer?.name || "Unknown customer",
    customerEmail: customer?.email || row.delivery_address.email || "",
    customerPhone: customer?.phone || row.delivery_address.phone || null,
    weeklyMenuId: deliveryWindow?.weekly_menu_id || null,
    weeklyMenuName: weeklyMenu?.name || null,
    deliveryWindowLabel: deliveryWindow?.label || null,
    status: row.status,
    subtotalCents: row.subtotal_cents,
    deliveryFeeCents: row.delivery_fee_cents,
    taxCents: row.tax_cents,
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
    approvalRefundStartedAt: row.approval_refund_started_at,
    adminDecisionNote: row.admin_decision_note,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stripeCheckoutSessionId: row.stripe_checkout_session_id,
    items,
    moveWindows,
  };
}

export async function getAdminOrdersData(
  options: { weeklyMenuId?: string; orderId?: string; limit?: number } = {},
): Promise<AdminOrder[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return [];

  let deliveryWindowIds: string[] | null = null;
  if (options.weeklyMenuId) {
    const { data: deliveryWindows, error: deliveryWindowsError } = await supabase
      .from("delivery_windows")
      .select("id")
      .eq("weekly_menu_id", options.weeklyMenuId);
    if (deliveryWindowsError) throw new Error(deliveryWindowsError.message);
    deliveryWindowIds = (deliveryWindows || []).map((window) => String(window.id));
    if (!deliveryWindowIds.length) return [];
  }

  let ordersQuery = supabase
    .from("orders")
    .select(
      "id, source, bread_club_membership_id, bread_club_fulfillment_id, stripe_invoice_id, customers(name, email, phone), delivery_windows(label, weekly_menu_id, weekly_menus(name, starts_at)), status, stripe_checkout_session_id, subtotal_cents, delivery_fee_cents, tax_cents, total_cents, delivery_address, delivery_miles, delivery_instructions, delivery_check, notes, next_week_ok, approval_mode, approved_at, denied_at, refunded_at, stripe_refund_id, approval_refund_started_at, admin_decision_note, paid_at, created_at, updated_at",
    );
  if (deliveryWindowIds) {
    ordersQuery = ordersQuery.in("delivery_window_id", deliveryWindowIds);
  }
  if (options.orderId) {
    ordersQuery = ordersQuery.eq("id", options.orderId);
  }
  const { data: orders, error: ordersError } = await ordersQuery
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 100);

  if (ordersError) {
    throw new Error(ordersError.message);
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
    throw new Error(itemsError.message);
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

async function sendUpdatedOrderStatusEmail(orderId: string, status: OrderStatus) {
  const [updatedOrder] = await getAdminOrdersData({ orderId, limit: 1 });

  if (updatedOrder?.customerEmail) {
    try {
      await sendCustomerOrderUpdateEmail(updatedOrder, status);
    } catch (emailError) {
      console.error("[orders] status email failed", emailError);
    }
  }

  return getAdminOrdersData();
}

async function sendCustomerOrderUpdateEmail(
  order: AdminOrder,
  status: OrderStatus,
) {
  const input = {
    to: order.customerEmail,
    customerName: order.customerName,
    orderSummary: order.items
      .map((item) => `${item.quantity} x ${item.productName}`)
      .join("\n"),
    deliveryWindow: order.deliveryWindowLabel || "Selected window",
    orderId: order.id,
  };

  return sendOrderStatusUpdate({
    ...input,
    statusLabel: getCustomerOrderStatusLabel(status),
  });
}

async function cancelUnpaidStorefrontOrder(input: {
  id: string;
  actorEmail?: string;
  expectedWeeklyMenuId?: string | null;
  checkoutExpiresAt: string | null;
  createdAt: string;
  stripeCheckoutSessionId: string | null;
}) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  let closedSessionId: string | null = null;
  if (input.stripeCheckoutSessionId) {
    const stripe = getStripe();
    if (!stripe) {
      throw new Error(
        "Stripe must be configured before an attached checkout can be canceled.",
      );
    }

    let session = await stripe.checkout.sessions.retrieve(
      input.stripeCheckoutSessionId,
    );
    if (session.status === "open") {
      try {
        session = await stripe.checkout.sessions.expire(session.id);
      } catch {
        session = await stripe.checkout.sessions.retrieve(session.id);
      }
    }
    if (session.status === "complete") {
      await completeStorefrontCheckoutSession(session);
      throw new Error(
        "Stripe already completed or is processing this payment. The order was not canceled; refresh its status.",
      );
    }
    if (session.status !== "expired") {
      throw new Error(
        "Stripe has not confirmed that checkout is closed. No inventory was released.",
      );
    }
    closedSessionId = session.id;
  } else {
    const explicitExpiration = input.checkoutExpiresAt
      ? new Date(input.checkoutExpiresAt).getTime()
      : Number.NaN;
    const createdAt = new Date(input.createdAt).getTime();
    const safeExpiration = Number.isFinite(explicitExpiration)
      ? explicitExpiration
      : createdAt + 26 * 60 * 60 * 1000;
    if (!Number.isFinite(safeExpiration) || safeExpiration > Date.now()) {
      throw new Error(
        "Secure checkout may still be starting. Wait for it to expire before canceling so a live payment link cannot oversell inventory.",
      );
    }
  }

  const { data, error } = await supabase.rpc("admin_cancel_storefront_checkout_scoped", {
    p_order_id: input.id,
    p_expected_weekly_menu_id: input.expectedWeeklyMenuId || null,
    p_session_id: closedSessionId,
    p_cancel_token: null,
    p_actor_email: input.actorEmail || null,
    p_reason: "Canceled by the bakery after Stripe checkout was confirmed closed.",
  });
  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error(
      "This checkout changed before it could be canceled. Refresh and try again.",
    );
  }

  return sendUpdatedOrderStatusEmail(input.id, "canceled");
}

export async function updateAdminOrderStatus(
  id: string,
  status: OrderStatus,
  actorEmail?: string,
  expectedWeeklyMenuId?: string | null,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data: existingOrder, error: existingOrderError } = await supabase
    .from("orders")
    .select(
      "source, status, stripe_checkout_session_id, checkout_expires_at, created_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (existingOrderError) throw new Error(existingOrderError.message);
  if (!existingOrder) throw new Error("Order could not be found.");

  const existingStatus = existingOrder.status as OrderStatus;
  const source = existingOrder.source as AdminOrder["source"];
  if (existingStatus === status) {
    return {
      orders: await getAdminOrdersData(),
      completionNotification: "not_applicable" as const,
    };
  }
  if (!isAdminOrderTransitionAllowed(source, existingStatus, status)) {
    throw new Error(
      "That order change is not allowed from its current status. Refresh the order and use one of the available actions.",
    );
  }
  if (
    source === "storefront" &&
    status === "canceled" &&
    (existingStatus === "pending_payment" ||
      existingStatus === "pending_approval_payment")
  ) {
    return {
      orders: await cancelUnpaidStorefrontOrder({
        id,
        actorEmail,
        expectedWeeklyMenuId,
        checkoutExpiresAt:
          (existingOrder.checkout_expires_at as string | null) ?? null,
        createdAt: String(existingOrder.created_at),
        stripeCheckoutSessionId:
          (existingOrder.stripe_checkout_session_id as string | null) ?? null,
      }),
      completionNotification: "not_applicable" as const,
    };
  }
  const { data: transitioned, error: transitionError } = await supabase.rpc(
    "admin_transition_order_status_scoped",
    {
      p_order_id: id,
      p_expected_weekly_menu_id: expectedWeeklyMenuId || null,
      p_expected_status: existingStatus,
      p_next_status: status,
      p_actor_email: actorEmail || null,
    },
  );
  if (transitionError) throw new Error(transitionError.message);
  if (!transitioned) {
    throw new Error(
      "This order changed in another tab. Refresh it before trying again.",
    );
  }

  const updatedOrder =
    status === "delivered"
      ? null
      : (await getAdminOrdersData({ orderId: id, limit: 1 }))[0] ?? null;
  const orders = await getAdminOrdersData();
  let completionNotification:
    | "not_applicable"
    | "sent"
    | "queued"
    | "already_sent"
    | "skipped" = "not_applicable";
  if (status === "delivered") {
    try {
      const result = await processOrderCompletionNotification(id);
      completionNotification = result.state;
    } catch (emailError) {
      completionNotification = "queued";
      console.error("[orders] completion email queued for retry", emailError);
    }
  } else if (
    updatedOrder &&
    existingStatus !== status &&
    updatedOrder.customerEmail
  ) {
    try {
      await sendCustomerOrderUpdateEmail(updatedOrder, status);
    } catch (emailError) {
      console.error("[orders] status email failed", emailError);
    }
  }

  return { orders, completionNotification };
}

export async function acceptApprovalOrder(
  id: string,
  actorEmail?: string,
  expectedWeeklyMenuId?: string | null,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data, error } = await supabase.rpc("admin_accept_approval_order_scoped", {
    p_order_id: id,
    p_expected_weekly_menu_id: expectedWeeklyMenuId || null,
    p_target_delivery_window_id: null,
    p_actor_email: actorEmail || null,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("The approval request changed. Refresh and try again.");

  return sendUpdatedOrderStatusEmail(id, "paid");
}

export async function moveApprovalOrderToNextWeek(
  id: string,
  targetDeliveryWindowId: string,
  actorEmail?: string,
  expectedWeeklyMenuId?: string | null,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data, error } = await supabase.rpc("admin_accept_approval_order_scoped", {
    p_order_id: id,
    p_expected_weekly_menu_id: expectedWeeklyMenuId || null,
    p_target_delivery_window_id: targetDeliveryWindowId,
    p_actor_email: actorEmail || null,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("The approval request changed. Refresh and try again.");

  return sendUpdatedOrderStatusEmail(id, "paid");
}

export async function denyApprovalOrderWithRefund(
  id: string,
  actorEmail?: string,
  expectedWeeklyMenuId?: string | null,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const stripe = getStripe();
  if (!stripe) throw new Error("Stripe is not configured for refunds.");

  const { data: claimData, error: claimError } = await supabase.rpc(
    "admin_begin_approval_refund_scoped",
    {
      p_order_id: id,
      p_expected_weekly_menu_id: expectedWeeklyMenuId || null,
      p_actor_email: actorEmail || null,
    },
  );
  if (claimError) throw new Error(claimError.message);
  const claim = Array.isArray(claimData) ? claimData[0] : claimData;
  if (!claim?.checkout_session_id) {
    throw new Error("Approval refund command returned an invalid result.");
  }

  const stripeClient = stripe;
  const checkoutSessionId = String(claim.checkout_session_id);

  async function createRefund(idempotencyKey: string) {
    const session = await stripeClient.checkout.sessions.retrieve(checkoutSessionId);
    const paymentIntent =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;
    if (!paymentIntent) {
      throw new Error("Stripe payment intent could not be found for this order.");
    }

    return stripeClient.refunds.create(
      {
        payment_intent: paymentIntent,
        metadata: {
          order_id: id,
          reason: "after_cutoff_approval_denied",
        },
      },
      { idempotencyKey },
    );
  }

  let refund = claim.refund_id
    ? await stripe.refunds.retrieve(String(claim.refund_id))
    : await createRefund(`order-denial-refund-${id}`);
  if (refund.status === "failed" || refund.status === "canceled") {
    refund = await createRefund(
      `order-denial-refund-${id}-retry-${refund.id}`,
    );
  }

  if (refund.status !== "succeeded") {
    const refundStatus = refund.status || "pending";
    const { data: recorded, error: pendingError } = await supabase.rpc(
      "admin_record_approval_refund_scoped",
      {
        p_order_id: id,
        p_expected_weekly_menu_id: expectedWeeklyMenuId || null,
        p_refund_id: refund.id,
        p_refund_status: refundStatus,
        p_actor_email: actorEmail || null,
      },
    );
    if (pendingError) throw new Error(pendingError.message);
    if (!recorded) {
      throw new Error(
        "The approval request changed while Stripe processed its refund. Refresh before retrying.",
      );
    }
    throw new Error(
      `Stripe refund is ${refundStatus}. The order remains in Needs approval until the refund is confirmed.`,
    );
  }

  const { data: finalized, error } = await supabase.rpc(
    "admin_finalize_approval_refund_scoped",
    {
      p_order_id: id,
      p_expected_weekly_menu_id: expectedWeeklyMenuId || null,
      p_refund_id: refund.id,
      p_actor_email: actorEmail || null,
    },
  );
  if (error) throw new Error(error.message);
  if (!finalized) return getAdminOrdersData();

  return sendUpdatedOrderStatusEmail(id, "canceled");
}
