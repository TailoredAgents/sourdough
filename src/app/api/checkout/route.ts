import { NextResponse } from "next/server";
import { z } from "zod";
import { isAfterWeeklyCutoff } from "@/lib/cutoff";
import { checkDeliveryAddress, type DeliveryCheckResult } from "@/lib/delivery";
import {
  sendCustomerOrderConfirmation,
} from "@/lib/email";
import {
  attachStripeSessionToOrder,
  buildOrderSummary,
  createPendingCheckoutOrder,
  releasePendingOrder,
} from "@/lib/order-records";
import { canOrderMenuProduct } from "@/lib/menu-availability";
import {
  getDeliverySettingsData,
  getDeliveryWindowForMenuData,
  getWeeklyMenuData,
  getMenuProductData,
} from "@/lib/storefront-data";
import { checkRateLimit } from "@/lib/rate-limit";
import { getStripe } from "@/lib/stripe";
import { buildCatalogLineItem, buildDeliveryLineItem } from "@/lib/stripe-line-items";
import { getSiteUrl } from "@/lib/utils";

function hasMinimumPhoneDigits(value: string) {
  return value.replace(/\D/g, "").length >= 7;
}

export const checkoutSchema = z.object({
  weeklyMenuId: z.string().uuid(),
  cart: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().min(1).max(24),
      }),
    )
    .min(1),
  customer: z.object({
    name: z.string().trim().min(2),
    email: z.string().trim().email(),
    phone: z.string().trim().refine(hasMinimumPhoneDigits, {
      message: "Enter a phone number with at least 7 digits.",
    }),
  }),
  address: z.object({
    line1: z.string().trim().min(3),
    line2: z.string().optional().default(""),
    city: z.string().trim().min(1),
    state: z.string().trim().min(1),
    postalCode: z.string().trim().regex(/^\d{5}$/, {
      message: "Enter a valid 5-digit ZIP code.",
    }),
  }),
  deliveryWindowId: z.string().min(1),
  deliveryInstructions: z.string().max(1000).optional().default(""),
  notes: z.string().max(1000).optional().default(""),
  nextWeekOk: z.boolean().optional(),
  acknowledgedTerms: z.literal(true),
});

export function getCheckoutDeliveryError(deliveryCheck: DeliveryCheckResult) {
  return deliveryCheck.eligible
    ? null
    : deliveryCheck.message || "This address is outside delivery range.";
}

export function getDeliveryWindowAvailabilityError(deliveryWindow: {
  capacity: number;
  reserved: number;
}) {
  return deliveryWindow.reserved < deliveryWindow.capacity
    ? null
    : "That delivery window is full. Please choose another available delivery window.";
}

export function getLastMinuteNotificationDeliveryWindow(deliveryWindow: {
  label: string;
}) {
  return deliveryWindow.label;
}

export function getMissingStripeCheckoutError(nodeEnv = process.env.NODE_ENV) {
  return nodeEnv === "production"
    ? "Online checkout is temporarily unavailable. Please contact the bakery before placing an order."
    : null;
}

export function getCheckoutRateLimitKey(request: Request, email: string) {
  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  const ip = forwardedFor.split(",")[0]?.trim() || "unknown-ip";
  return `${ip}:${email.toLowerCase()}`;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = checkoutSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please complete the order form before checkout." },
      { status: 400 },
    );
  }

  const checkout = parsed.data;
  const rateLimit = await checkRateLimit({
    scope: "checkout_start",
    key: getCheckoutRateLimitKey(request, checkout.customer.email),
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many order attempts. Please try again later." },
      { status: 429 },
    );
  }

  const weeklyMenu = await getWeeklyMenuData(checkout.weeklyMenuId);
  const afterCutoff = isAfterWeeklyCutoff(weeklyMenu?.orderCutoffAt);

  if (!weeklyMenu?.published) {
    return NextResponse.json(
      { error: "Ordering is not open yet. Please check back for the next bake drop." },
      { status: 400 },
    );
  }

  if (afterCutoff && typeof checkout.nextWeekOk !== "boolean") {
    return NextResponse.json(
      { error: "Please answer whether next week works if this week is unavailable." },
      { status: 400 },
    );
  }

  const deliveryWindow = await getDeliveryWindowForMenuData(
    checkout.deliveryWindowId,
    weeklyMenu.id,
  );

  if (!deliveryWindow) {
    return NextResponse.json(
      { error: "Please choose an available delivery window." },
      { status: 400 },
    );
  }

  const deliveryWindowError = getDeliveryWindowAvailabilityError(deliveryWindow);
  if (deliveryWindowError) {
    return NextResponse.json(
      { error: deliveryWindowError },
      { status: 400 },
    );
  }

  const deliverySettings = await getDeliverySettingsData();
  const deliveryCheck = checkDeliveryAddress(checkout.address, deliverySettings);
  const state = checkout.address.state.trim().toUpperCase();
  if (state !== "GA" && state !== "GEORGIA") {
    return NextResponse.json(
      { error: "Delivery is currently available only within Georgia." },
      { status: 400 },
    );
  }

  const deliveryError = getCheckoutDeliveryError(deliveryCheck);
  if (deliveryError) {
    return NextResponse.json(
      { error: deliveryError },
      { status: 400 },
    );
  }

  const items = [];
  for (const cartItem of checkout.cart) {
    const menuProduct = await getMenuProductData(cartItem.productId, weeklyMenu.id);
    if (!menuProduct) {
      return NextResponse.json(
        { error: "One of the selected products is no longer available." },
        { status: 400 },
      );
    }
    if (!canOrderMenuProduct(menuProduct)) {
      return NextResponse.json(
        { error: `${menuProduct.name} is currently unavailable.` },
        { status: 400 },
      );
    }
    if (cartItem.quantity > menuProduct.remainingQuantity) {
      return NextResponse.json(
        { error: `${menuProduct.name} does not have enough inventory left.` },
        { status: 400 },
      );
    }
    items.push({ ...menuProduct, quantity: cartItem.quantity });
  }

  const orderSummary = buildOrderSummary(items);

  const stripe = getStripe();
  if (!stripe) {
    const missingStripeError = getMissingStripeCheckoutError();
    if (missingStripeError) {
      return NextResponse.json({ error: missingStripeError }, { status: 503 });
    }

    await sendCustomerOrderConfirmation({
      to: checkout.customer.email,
      customerName: checkout.customer.name,
      orderSummary,
      deliveryWindow: deliveryWindow.label,
    });

    return NextResponse.json({
      url: `${getSiteUrl()}/order/success?demo=1`,
      message:
        "Demo checkout complete. Add STRIPE_SECRET_KEY to redirect to Stripe.",
    });
  }

  let pendingOrder;
  try {
    pendingOrder = await createPendingCheckoutOrder({
      approvalMode: afterCutoff ? "after_cutoff" : "standard",
      checkout,
      deliveryCheck,
      deliveryWindowId: deliveryWindow.id,
      items,
      reserveInventory: !afterCutoff,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Order could not be reserved.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: checkout.customer.email,
      phone_number_collection: { enabled: true },
      success_url: `${getSiteUrl()}/order/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${getSiteUrl()}/order/canceled?order_id=${pendingOrder.id}&token=${pendingOrder.checkoutCancelToken}`,
      line_items: [
        ...items.map(buildCatalogLineItem),
        buildDeliveryLineItem(deliveryCheck.feeCents),
      ],
      metadata: {
        order_id: pendingOrder.id,
        weekly_menu_id: weeklyMenu.id,
        approval_mode: pendingOrder.approvalMode,
        next_week_ok: afterCutoff ? String(Boolean(checkout.nextWeekOk)) : "",
        customer_name: checkout.customer.name,
        customer_phone: checkout.customer.phone,
        delivery_window_id: deliveryWindow.id,
        delivery_window: deliveryWindow.label,
        address: `${checkout.address.line1}, ${checkout.address.city}, ${checkout.address.state} ${checkout.address.postalCode}`,
        delivery_instructions: checkout.deliveryInstructions || "",
        notes: checkout.notes || "",
        order_summary: pendingOrder.orderSummary,
      },
    });

    await attachStripeSessionToOrder(pendingOrder.id, session.id);
  } catch (error) {
    await releasePendingOrder(pendingOrder.id);
    const message =
      error instanceof Error ? error.message : "Stripe checkout could not be started.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ url: session.url });
}
