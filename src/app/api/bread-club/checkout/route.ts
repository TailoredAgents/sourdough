import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getBreadClubCheckoutGate,
  isBreadClubAutomaticTaxEnabled,
  isBreadClubControlledPreviewCustomer,
  isBreadClubPublicEnabled,
} from "@/lib/bread-club/config";
import { getBreadClubEnrollmentData } from "@/lib/bread-club/data";
import {
  buildBreadClubConsentText,
  findBreadClubDeliveryPrice,
  getBreadClubCycleTotalCents,
  normalizeBreadClubSelection,
} from "@/lib/bread-club/pricing";
import {
  attachStripeSubscriptionCheckout,
  createPendingBreadClubCheckout,
  markBreadClubCheckoutIncomplete,
  validateSelectionAcrossCycle,
} from "@/lib/bread-club/records";
import { checkDeliveryAddressWithRoutes } from "@/lib/delivery";
import { checkRateLimit } from "@/lib/rate-limit";
import { getDeliverySettingsData } from "@/lib/storefront-data";
import { getStripe } from "@/lib/stripe";
import { createStripeDeliveryCustomer } from "@/lib/stripe-tax";
import { getSiteUrl } from "@/lib/utils";
import { getCurrentAdmin } from "@/lib/admin-auth";

function hasMinimumPhoneDigits(value: string) {
  return value.replace(/\D/g, "").length >= 7;
}

export const breadClubCheckoutSchema = z.object({
  planId: z.string().uuid(),
  selection: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1).max(2),
      }),
    )
    .min(1)
    .max(2),
  customer: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(254),
    phone: z.string().trim().refine(hasMinimumPhoneDigits, {
      message: "Enter a phone number with at least 7 digits.",
    }),
  }),
  address: z.object({
    line1: z.string().trim().min(3).max(180),
    line2: z.string().trim().max(120).optional().default(""),
    city: z.string().trim().min(1).max(100),
    state: z.string().trim().min(2).max(20),
    postalCode: z.string().trim().regex(/^\d{5}$/),
  }),
  deliveryInstructions: z.string().trim().max(1000).optional().default(""),
  acknowledgedAutoRenewal: z.literal(true),
  consentText: z.string().trim().min(40).max(1000),
});

function requestIdentity(request: Request, email: string) {
  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  const ip = forwardedFor.split(",")[0]?.trim() || "unknown-ip";
  return {
    rateLimitKey: `${ip}:${email.trim().toLowerCase()}`,
    ipHash:
      ip === "unknown-ip"
        ? null
        : createHash("sha256").update(ip).digest("hex"),
  };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const parsed = breadClubCheckoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ||
          "Please complete Bread Club enrollment before checkout.",
      },
      { status: 400 },
    );
  }
  const checkout = parsed.data;
  const identity = requestIdentity(request, checkout.customer.email);
  const rateLimit = await checkRateLimit({
    scope: "bread_club_checkout",
    key: identity.rateLimitKey,
    limit: 4,
    windowMs: 60 * 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many enrollment attempts. Please try again later." },
      { status: 429 },
    );
  }

  const currentAdmin = isBreadClubPublicEnabled()
    ? null
    : await getCurrentAdmin();
  const controlledPreviewCustomer =
    isBreadClubControlledPreviewCustomer(
      checkout.customer.email,
      currentAdmin?.email,
    );
  const gate = getBreadClubCheckoutGate(
    checkout.customer.email,
    currentAdmin?.email,
  );
  if (!gate.allowed) {
    return NextResponse.json({ error: gate.reason }, { status: 403 });
  }

  const [enrollment, deliverySettings] = await Promise.all([
    getBreadClubEnrollmentData(),
    getDeliverySettingsData(),
  ]);
  if (
    enrollment.settings.taxStatus === "pending" &&
    !controlledPreviewCustomer
  ) {
    return NextResponse.json(
      {
        error:
          "Bread Club enrollment is paused while the bakery confirms applicable tax treatment.",
      },
      { status: 503 },
    );
  }
  if (enrollment.weeks.length !== 4) {
    return NextResponse.json(
      {
        error:
          "Four Sunday delivery dates are not available right now. Please try again shortly.",
      },
      { status: 409 },
    );
  }

  const plan = enrollment.plans.find(
    (item) => item.id === checkout.planId && item.active,
  );
  if (!plan) {
    return NextResponse.json(
      { error: "That Bread Club plan is not available." },
      { status: 400 },
    );
  }

  const selection = normalizeBreadClubSelection(checkout.selection);
  const selectionError = validateSelectionAcrossCycle(
    plan,
    selection,
    enrollment.weeks,
  );
  if (selectionError) {
    return NextResponse.json({ error: selectionError }, { status: 409 });
  }

  const state = checkout.address.state.trim().toUpperCase();
  if (state !== "GA" && state !== "GEORGIA") {
    return NextResponse.json(
      { error: "Bread Club delivery is currently available only in Georgia." },
      { status: 400 },
    );
  }
  const deliveryCheck = await checkDeliveryAddressWithRoutes(
    checkout.address,
    deliverySettings,
  );
  if (!deliveryCheck.eligible || deliveryCheck.preliminary) {
    return NextResponse.json(
      {
        error:
          deliveryCheck.message ||
          "This address could not be confirmed for Bread Club delivery.",
      },
      { status: 400 },
    );
  }

  const deliveryPrice = findBreadClubDeliveryPrice(
    enrollment.deliveryPrices,
    deliveryCheck.durationMinutes,
    deliveryCheck.feeCents,
  );
  if (!deliveryPrice) {
    return NextResponse.json(
      { error: "The Bread Club delivery price is not configured." },
      { status: 503 },
    );
  }

  const stripe = getStripe();
  const currentPlanPrice =
    plan.stripePriceId && plan.stripePriceCents === plan.priceCents;
  const currentDeliveryPrice =
    deliveryPrice.stripePriceId &&
    deliveryPrice.stripePriceCents === deliveryPrice.priceCents;
  if (!stripe || !currentPlanPrice || !currentDeliveryPrice) {
    return NextResponse.json(
      {
        error:
          "Bread Club billing is not ready yet. No enrollment charge was created.",
      },
      { status: 503 },
    );
  }

  const cycleTotalCents = getBreadClubCycleTotalCents(
    plan.priceCents,
    deliveryPrice.priceCents,
  );
  const canonicalConsentText = buildBreadClubConsentText(
    cycleTotalCents,
    isBreadClubAutomaticTaxEnabled(),
  );
  if (checkout.consentText !== canonicalConsentText) {
    return NextResponse.json(
      {
        error:
          "The Bread Club total or renewal terms changed. Review the authorization and check it again.",
      },
      { status: 409 },
    );
  }

  let pending;
  try {
    pending = await createPendingBreadClubCheckout({
      checkout: {
        ...checkout,
        consentText: canonicalConsentText,
      },
      consentIpHash: identity.ipHash,
      consentVersion: enrollment.settings.consentVersion,
      deliveryCheck,
      deliveryPrice,
      plan,
      selection,
      weeks: enrollment.weeks,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Bread Club capacity could not be reserved.",
      },
      { status: 409 },
    );
  }

  try {
    const automaticTaxEnabled = isBreadClubAutomaticTaxEnabled();
    const stripeCustomer = automaticTaxEnabled
      ? await createStripeDeliveryCustomer(stripe, {
          name: checkout.customer.name,
          email: checkout.customer.email,
          phone: checkout.customer.phone,
          address: checkout.address,
          metadata: {
            bread_club_membership_id: pending.membershipId,
            customer_source: "bread_club_checkout",
          },
        })
      : null;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ...(stripeCustomer
        ? { customer: stripeCustomer.id }
        : { customer_email: checkout.customer.email }),
      phone_number_collection: { enabled: true },
      line_items: [
        { price: plan.stripePriceId!, quantity: 1 },
        { price: deliveryPrice.stripePriceId!, quantity: 1 },
      ],
      automatic_tax: {
        enabled: automaticTaxEnabled,
      },
      success_url: `${getSiteUrl()}/bread-club/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${getSiteUrl()}/api/bread-club/cancel-checkout?membership_id=${pending.membershipId}&token=${pending.checkoutCancelToken}`,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      metadata: {
        checkout_kind: "bread_club_subscription",
        bread_club_membership_id: pending.membershipId,
        bread_club_cycle_id: pending.cycleId,
        bread_club_plan_id: plan.id,
        delivery_band: deliveryPrice.bandKey,
        consent_version: enrollment.settings.consentVersion,
      },
      subscription_data: {
        metadata: {
          checkout_kind: "bread_club_subscription",
          bread_club_membership_id: pending.membershipId,
          bread_club_plan_id: plan.id,
          delivery_band: deliveryPrice.bandKey,
        },
      },
    });
    await attachStripeSubscriptionCheckout(pending.membershipId, session.id);

    return NextResponse.json({
      url: session.url,
      membershipId: pending.membershipId,
      firstDeliveryAt: pending.firstDeliveryAt,
      recurringTotalCents: getBreadClubCycleTotalCents(
        plan.priceCents,
        deliveryPrice.priceCents,
      ),
      taxTreatment: isBreadClubAutomaticTaxEnabled()
        ? "calculated_by_stripe"
        : "not_added",
    });
  } catch (error) {
    await markBreadClubCheckoutIncomplete(
      pending.membershipId,
      pending.cycleId,
    );
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Stripe enrollment checkout could not be started.",
      },
      { status: 500 },
    );
  }
}
