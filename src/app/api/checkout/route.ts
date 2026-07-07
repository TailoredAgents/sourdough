import { NextResponse } from "next/server";
import { z } from "zod";
import { isAfterWeeklyCutoff } from "@/lib/cutoff";
import { checkDeliveryAddress } from "@/lib/delivery";
import { sendOrderConfirmation } from "@/lib/email";
import {
  attachStripeSessionToOrder,
  buildOrderSummary,
  createPendingCheckoutOrder,
  releasePendingOrder,
} from "@/lib/order-records";
import {
  getDeliverySettingsData,
  getDeliveryWindowData,
  getMenuProductData,
} from "@/lib/storefront-data";
import { getStripe } from "@/lib/stripe";
import { getSiteUrl } from "@/lib/utils";

const checkoutSchema = z.object({
  cart: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().min(1).max(24),
      }),
    )
    .min(1),
  customer: z.object({
    name: z.string().min(2),
    email: z.string().email(),
    phone: z.string().min(7),
  }),
  address: z.object({
    line1: z.string().min(3),
    line2: z.string().optional().default(""),
    city: z.string().min(1),
    state: z.string().min(1),
    postalCode: z.string().min(3),
  }),
  deliveryWindowId: z.string().min(1),
  notes: z.string().max(1000).optional().default(""),
});

export async function POST(request: Request) {
  const parsed = checkoutSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please complete the order form before checkout." },
      { status: 400 },
    );
  }

  const checkout = parsed.data;
  const deliveryWindow = await getDeliveryWindowData(checkout.deliveryWindowId);

  if (!deliveryWindow) {
    return NextResponse.json(
      { error: "Please choose an available delivery window." },
      { status: 400 },
    );
  }

  const deliverySettings = await getDeliverySettingsData();
  const deliveryCheck = checkDeliveryAddress(checkout.address, deliverySettings);
  const state = checkout.address.state.trim().toUpperCase();
  if (state !== "GA" && state !== "GEORGIA") {
    return NextResponse.json(
      { error: "Delivery is only available within Georgia for launch." },
      { status: 400 },
    );
  }

  if (!deliveryCheck.eligible && !isAfterWeeklyCutoff()) {
    return NextResponse.json(
      { error: deliveryCheck.message || "This address is outside delivery range." },
      { status: 400 },
    );
  }

  const items = [];
  for (const cartItem of checkout.cart) {
    const menuProduct = await getMenuProductData(cartItem.productId);
    if (!menuProduct) {
      return NextResponse.json(
        { error: "One of the selected products is no longer available." },
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

  if (isAfterWeeklyCutoff()) {
    if (process.env.BAKERY_EMAIL) {
      await sendOrderConfirmation({
        to: process.env.BAKERY_EMAIL,
        customerName: checkout.customer.name,
        orderSummary: `${orderSummary}\n\nCustomer: ${checkout.customer.email} / ${checkout.customer.phone}\nAddress: ${checkout.address.line1}, ${checkout.address.city}, ${checkout.address.state} ${checkout.address.postalCode}\nNotes: ${checkout.notes}`,
        deliveryWindow: "Last-minute request after Thursday cutoff",
      });
    }

    return NextResponse.json({
      url: `${getSiteUrl()}/order/success?demo=last-minute-request`,
      message: "Last-minute request sent.",
    });
  }

  const stripe = getStripe();
  if (!stripe) {
    await sendOrderConfirmation({
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
      checkout,
      deliveryCheck,
      deliveryWindowId: deliveryWindow.id,
      items,
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
      cancel_url: `${getSiteUrl()}/order/canceled`,
      line_items: [
        ...items.map((item) => {
          return {
            quantity: item.quantity,
            price_data: {
              currency: "usd",
              unit_amount: item.priceCents,
              product_data: {
                name: item.name,
                description: item.description,
              },
            },
          };
        }),
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: deliveryCheck.feeCents,
            product_data: {
              name: "Local delivery",
              description: "Radius-based delivery from Canton, GA",
            },
          },
        },
      ],
      metadata: {
        order_id: pendingOrder.id,
        customer_name: checkout.customer.name,
        customer_phone: checkout.customer.phone,
        delivery_window_id: deliveryWindow.id,
        delivery_window: deliveryWindow.label,
        address: `${checkout.address.line1}, ${checkout.address.city}, ${checkout.address.state} ${checkout.address.postalCode}`,
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
