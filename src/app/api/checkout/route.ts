import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  isPastSundayDeliveryEnd,
  isRequestDeliveryWeek,
} from "@/lib/bake-schedule";
import {
  checkDeliveryAddressWithRoutes,
  type DeliveryCheckResult,
} from "@/lib/delivery";
import {
  sendCustomerOrderConfirmation,
} from "@/lib/email";
import {
  attachStripeSessionToOrder,
  buildOrderSummary,
  cancelExpiredCheckoutSession,
  createPendingCheckoutOrder,
  getExistingCheckoutAttempt,
  releasePendingOrder,
  type PendingOrder,
} from "@/lib/order-records";
import { completeStorefrontCheckoutSession } from "@/lib/order-payment";
import { canOrderMenuProduct } from "@/lib/menu-availability";
import {
  getDeliverySettingsData,
  getDeliveryWindowForMenuData,
  getWeeklyMenuData,
  getMenuProductData,
} from "@/lib/storefront-data";
import { checkRateLimitChain, getRequestClientIp } from "@/lib/rate-limit";
import { getStripe } from "@/lib/stripe";
import { buildCatalogLineItem, buildDeliveryLineItem } from "@/lib/stripe-line-items";
import {
  createStripeDeliveryCustomer,
  isStripeAutomaticTaxEnabled,
  toStripeAddress,
} from "@/lib/stripe-tax";
import { getSiteUrl } from "@/lib/utils";
import type { MenuProduct } from "@/lib/types";

function hasMinimumPhoneDigits(value: string) {
  return value.replace(/\D/g, "").length >= 7;
}

export const checkoutSchema = z.object({
  checkoutAttemptId: z.string().uuid(),
  weeklyMenuId: z.string().uuid(),
  cart: z
    .array(
      z.object({
        productId: z.string().min(1).max(100),
        quantity: z.number().int().min(1).max(24),
      }),
    )
    .min(1)
    .max(50),
  customer: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(254),
    phone: z
      .string()
      .trim()
      .max(40)
      .refine(hasMinimumPhoneDigits, {
        message: "Enter a phone number with at least 7 digits.",
      }),
  }),
  address: z.object({
    line1: z.string().trim().min(3).max(180),
    line2: z.string().trim().max(120).optional().default(""),
    city: z.string().trim().min(1).max(100),
    state: z.string().trim().min(1).max(20),
    postalCode: z.string().trim().regex(/^\d{5}$/, {
      message: "Enter a valid 5-digit ZIP code.",
    }),
  }),
  deliveryWindowId: z.string().min(1).max(100),
  deliveryInstructions: z.string().max(1000).optional().default(""),
  notes: z.string().max(1000).optional().default(""),
  nextWeekOk: z.boolean().optional(),
  acknowledgedTerms: z.literal(true),
});

type ParsedCheckout = z.infer<typeof checkoutSchema>;
type CheckoutItem = MenuProduct & { quantity: number };

class CheckoutStartFailure extends Error {
  resetCheckoutAttempt: boolean;

  constructor(message: string, resetCheckoutAttempt = false) {
    super(message);
    this.resetCheckoutAttempt = resetCheckoutAttempt;
  }
}

export function buildCheckoutRequestHash(checkout: ParsedCheckout) {
  const canonicalRequest = {
    weeklyMenuId: checkout.weeklyMenuId,
    cart: [...checkout.cart].sort((a, b) =>
      a.productId.localeCompare(b.productId),
    ),
    customer: {
      name: checkout.customer.name.trim(),
      email: checkout.customer.email.trim().toLowerCase(),
      phone: checkout.customer.phone.trim(),
    },
    address: {
      line1: checkout.address.line1.trim(),
      line2: checkout.address.line2?.trim() || "",
      city: checkout.address.city.trim(),
      state: checkout.address.state.trim().toUpperCase(),
      postalCode: checkout.address.postalCode.trim(),
    },
    deliveryWindowId: checkout.deliveryWindowId,
    deliveryInstructions: checkout.deliveryInstructions.trim(),
    notes: checkout.notes.trim(),
    nextWeekOk: checkout.nextWeekOk ?? null,
    acknowledgedTerms: checkout.acknowledgedTerms,
  };
  return createHash("sha256")
    .update(JSON.stringify(canonicalRequest))
    .digest("hex");
}

async function startHostedCheckout({
  checkout,
  deliveryCheck,
  deliveryWindowLabel,
  items,
  pendingOrder,
  stripe,
  weeklyMenuId,
}: {
  checkout: ParsedCheckout;
  deliveryCheck: DeliveryCheckResult;
  deliveryWindowLabel: string;
  items: CheckoutItem[];
  pendingOrder: PendingOrder;
  stripe: NonNullable<ReturnType<typeof getStripe>>;
  weeklyMenuId: string;
}) {
  let session: Awaited<ReturnType<typeof stripe.checkout.sessions.create>> | undefined;
  try {
    const automaticTaxEnabled = isStripeAutomaticTaxEnabled();
    const stripeCustomer = automaticTaxEnabled
      ? await createStripeDeliveryCustomer(
          stripe,
          {
            name: checkout.customer.name,
            email: checkout.customer.email,
            phone: checkout.customer.phone,
            address: checkout.address,
            metadata: {
              storefront_order_id: pendingOrder.id,
              customer_source: "storefront_checkout",
            },
          },
          {
            idempotencyKey: `storefront-customer-${checkout.checkoutAttemptId}`,
          },
        )
      : null;
    const checkoutExpiresAt = Math.floor(
      new Date(pendingOrder.checkoutExpiresAt).getTime() / 1000,
    );
    if (!Number.isSafeInteger(checkoutExpiresAt)) {
      throw new Error("Checkout expiration is invalid.");
    }

    session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        expires_at: checkoutExpiresAt,
        ...(stripeCustomer
          ? { customer: stripeCustomer.id }
          : { customer_email: checkout.customer.email }),
        phone_number_collection: { enabled: true },
        automatic_tax: { enabled: automaticTaxEnabled },
        payment_intent_data: {
          shipping: {
            name: checkout.customer.name,
            phone: checkout.customer.phone,
            address: toStripeAddress(checkout.address),
          },
        },
        success_url: `${getSiteUrl()}/order/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${getSiteUrl()}/order/canceled?order_id=${pendingOrder.id}&token=${pendingOrder.checkoutCancelToken}`,
        line_items: [
          ...items.map(buildCatalogLineItem),
          buildDeliveryLineItem(deliveryCheck.feeCents),
        ],
        metadata: {
          order_id: pendingOrder.id,
          weekly_menu_id: weeklyMenuId,
          approval_mode: pendingOrder.approvalMode,
          next_week_ok:
            pendingOrder.approvalMode === "after_cutoff"
              ? String(Boolean(checkout.nextWeekOk))
              : "",
          customer_name: checkout.customer.name,
          customer_phone: checkout.customer.phone,
          delivery_window_id: checkout.deliveryWindowId,
          delivery_window: deliveryWindowLabel,
          address: `${checkout.address.line1}, ${checkout.address.city}, ${checkout.address.state} ${checkout.address.postalCode}`,
          delivery_instructions: checkout.deliveryInstructions || "",
          notes: checkout.notes || "",
          order_summary: pendingOrder.orderSummary,
        },
      },
      {
        idempotencyKey: `storefront-checkout-${checkout.checkoutAttemptId}`,
      },
    );

    await attachStripeSessionToOrder(pendingOrder.id, session.id);
    if (!session.url) {
      throw new Error("Stripe Checkout did not return a hosted payment URL.");
    }
    return session.url;
  } catch (error) {
    let resetCheckoutAttempt = false;
    if (session?.id) {
      try {
        await stripe.checkout.sessions.expire(session.id);
        await attachStripeSessionToOrder(pendingOrder.id, session.id);
        resetCheckoutAttempt = Boolean(
          await releasePendingOrder(pendingOrder.id, session.id),
        );
      } catch (cleanupError) {
        console.error("[checkout] Stripe session cleanup deferred", {
          orderId: pendingOrder.id,
          sessionId: session.id,
          cleanupError,
        });
      }
    } else {
      console.error("[checkout] Stripe session creation outcome is uncertain", {
        orderId: pendingOrder.id,
        error,
      });
    }
    throw new CheckoutStartFailure(
      "Stripe checkout could not be started. Please try again.",
      resetCheckoutAttempt,
    );
  }
}

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
    : "That Sunday delivery time is full. Please choose another available Sunday delivery date.";
}

export function getCheckoutRequiresApproval(
  weeklyMenu: { orderCutoffAt: string },
  deliveryWindow: { endsAt: string },
  now = new Date(),
) {
  return isRequestDeliveryWeek(
    weeklyMenu.orderCutoffAt,
    deliveryWindow.endsAt,
    now,
  );
}

export function getCheckoutDeliveryWindowError(
  deliveryWindow: {
    capacity: number;
    reserved: number;
    endsAt: string;
  },
  requiresApproval: boolean,
  now = new Date(),
) {
  if (isPastSundayDeliveryEnd(deliveryWindow.endsAt, now)) {
    return "That Sunday delivery time has passed. Please choose the next Sunday.";
  }
  if (requiresApproval) return null;
  return getDeliveryWindowAvailabilityError(deliveryWindow);
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
  return `${getRequestClientIp(request)}:${email.toLowerCase()}`;
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
  const clientIp = getRequestClientIp(request);
  const rateLimit = await checkRateLimitChain(
    {
      scope: "checkout_start_ip",
      key: clientIp,
      limit: 20,
      windowMs: 60 * 60 * 1000,
    },
    {
      scope: "checkout_start",
      key: getCheckoutRateLimitKey(request, checkout.customer.email),
      limit: 5,
      windowMs: 60 * 60 * 1000,
    },
  );

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many order attempts. Please try again later." },
      { status: 429 },
    );
  }

  const checkoutRequestHash = buildCheckoutRequestHash(checkout);
  const stripe = getStripe();
  if (stripe) {
    let existingAttempt;
    try {
      existingAttempt = await getExistingCheckoutAttempt(
        checkout.checkoutAttemptId,
        checkoutRequestHash,
      );
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Checkout attempt could not be verified.",
        },
        { status: 409 },
      );
    }

    if (existingAttempt) {
      if (
        existingAttempt.status !== "pending_payment" &&
        existingAttempt.status !== "pending_approval_payment"
      ) {
        if (
          existingAttempt.status !== "canceled" &&
          existingAttempt.stripeCheckoutSessionId
        ) {
          return NextResponse.json({
            url: `${getSiteUrl()}/order/success?session_id=${encodeURIComponent(existingAttempt.stripeCheckoutSessionId)}`,
          });
        }
        return NextResponse.json(
          {
            error:
              "That checkout attempt is closed. Please start checkout again.",
            resetCheckoutAttempt: true,
          },
          { status: 409 },
        );
      }

      if (existingAttempt.stripeCheckoutSessionId) {
        try {
          const existingSession = await stripe.checkout.sessions.retrieve(
            existingAttempt.stripeCheckoutSessionId,
          );
          if (existingSession.status === "open" && existingSession.url) {
            return NextResponse.json({ url: existingSession.url });
          }
          if (existingSession.status === "complete") {
            await completeStorefrontCheckoutSession(existingSession);
            return NextResponse.json({
              url: `${getSiteUrl()}/order/success?session_id=${encodeURIComponent(existingSession.id)}`,
            });
          }
          if (existingSession.status === "expired") {
            await cancelExpiredCheckoutSession(
              existingSession.id,
              existingAttempt.pendingOrder.id,
            );
            return NextResponse.json(
              {
                error:
                  "That secure checkout expired. Please start checkout again.",
                resetCheckoutAttempt: true,
              },
              { status: 409 },
            );
          }
        } catch (error) {
          console.error("[checkout] existing Stripe session lookup failed", {
            orderId: existingAttempt.pendingOrder.id,
            sessionId: existingAttempt.stripeCheckoutSessionId,
            error,
          });
          return NextResponse.json(
            {
              error:
                "Secure checkout could not be resumed. Please try again shortly.",
            },
            { status: 502 },
          );
        }
      }

      try {
        return NextResponse.json({
          url: await startHostedCheckout({
            checkout,
            deliveryCheck: existingAttempt.deliveryCheck,
            deliveryWindowLabel: existingAttempt.deliveryWindowLabel,
            items: existingAttempt.items,
            pendingOrder: existingAttempt.pendingOrder,
            stripe,
            weeklyMenuId: existingAttempt.weeklyMenuId,
          }),
        });
      } catch (error) {
        const resetCheckoutAttempt =
          error instanceof CheckoutStartFailure
            ? error.resetCheckoutAttempt
            : false;
        return NextResponse.json(
          {
            error: "Stripe checkout could not be started. Please try again.",
            ...(resetCheckoutAttempt ? { resetCheckoutAttempt: true } : {}),
          },
          { status: 502 },
        );
      }
    }
  }

  const weeklyMenu = await getWeeklyMenuData(checkout.weeklyMenuId);

  if (!weeklyMenu?.published) {
    return NextResponse.json(
      { error: "Ordering is not open yet. Please check back for the next bake drop." },
      { status: 400 },
    );
  }

  const deliveryWindow = await getDeliveryWindowForMenuData(
    checkout.deliveryWindowId,
    weeklyMenu.id,
  );

  if (!deliveryWindow) {
    return NextResponse.json(
      { error: "Please choose an available Sunday delivery time." },
      { status: 400 },
    );
  }

  const requiresApproval = getCheckoutRequiresApproval(weeklyMenu, deliveryWindow);

  if (requiresApproval && typeof checkout.nextWeekOk !== "boolean") {
    return NextResponse.json(
      { error: "Please answer whether next Sunday works if this Sunday is unavailable." },
      { status: 400 },
    );
  }

  const deliveryWindowError = getCheckoutDeliveryWindowError(
    deliveryWindow,
    requiresApproval,
  );
  if (deliveryWindowError) {
    return NextResponse.json(
      { error: deliveryWindowError },
      { status: 400 },
    );
  }

  const deliverySettings = await getDeliverySettingsData();
  const deliveryCheck = await checkDeliveryAddressWithRoutes(
    checkout.address,
    deliverySettings,
  );
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
      approvalMode: requiresApproval ? "after_cutoff" : "standard",
      checkout,
      checkoutRequestHash,
      deliveryCheck,
      deliveryWindowId: deliveryWindow.id,
      items,
      reserveInventory: !requiresApproval,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Order could not be reserved.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    return NextResponse.json({
      url: await startHostedCheckout({
        checkout,
        deliveryCheck,
        deliveryWindowLabel: deliveryWindow.label,
        items,
        pendingOrder,
        stripe,
        weeklyMenuId: weeklyMenu.id,
      }),
    });
  } catch (error) {
    const resetCheckoutAttempt =
      error instanceof CheckoutStartFailure
        ? error.resetCheckoutAttempt
        : false;
    return NextResponse.json(
      {
        error: "Stripe checkout could not be started. Please try again.",
        ...(resetCheckoutAttempt ? { resetCheckoutAttempt: true } : {}),
      },
      { status: 502 },
    );
  }
}
