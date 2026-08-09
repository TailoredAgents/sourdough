import { createHash } from "crypto";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
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
  expireBreadClubCheckoutSession,
  getExistingBreadClubCheckoutAttempt,
  markBreadClubCheckoutIncomplete,
  type PendingBreadClubCheckout,
  validateSelectionAcrossCycle,
} from "@/lib/bread-club/records";
import { checkDeliveryAddressWithRoutes } from "@/lib/delivery";
import { checkRateLimitChain, getRequestClientIp } from "@/lib/rate-limit";
import { getDeliverySettingsData } from "@/lib/storefront-data";
import { getStripe } from "@/lib/stripe";
import { createStripeDeliveryCustomer } from "@/lib/stripe-tax";
import { getSiteUrl } from "@/lib/utils";
import { getCurrentAdmin } from "@/lib/admin-auth";

function hasMinimumPhoneDigits(value: string) {
  return value.replace(/\D/g, "").length >= 7;
}

export const breadClubCheckoutSchema = z.object({
  checkoutAttemptId: z.string().uuid(),
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
    state: z.string().trim().min(2).max(20),
    postalCode: z.string().trim().regex(/^\d{5}$/),
  }),
  deliveryInstructions: z.string().trim().max(1000).optional().default(""),
  acknowledgedAutoRenewal: z.literal(true),
  consentText: z.string().trim().min(40).max(1000),
});

type ParsedBreadClubCheckout = z.infer<typeof breadClubCheckoutSchema>;

export function buildBreadClubCheckoutRequestHash(
  checkout: ParsedBreadClubCheckout,
) {
  const canonicalRequest = {
    checkoutAttemptId: checkout.checkoutAttemptId,
    planId: checkout.planId,
    selection: normalizeBreadClubSelection(checkout.selection).map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
    })),
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
    deliveryInstructions: checkout.deliveryInstructions.trim(),
    acknowledgedAutoRenewal: checkout.acknowledgedAutoRenewal,
    consentText: checkout.consentText,
  };
  return createHash("sha256")
    .update(JSON.stringify(canonicalRequest))
    .digest("hex");
}

class BreadClubCheckoutStartFailure extends Error {
  constructor(
    message: string,
    readonly resetCheckoutAttempt: boolean,
  ) {
    super(message);
  }
}

function checkoutResponse(
  url: string,
  pending: PendingBreadClubCheckout,
) {
  return NextResponse.json({
    url,
    membershipId: pending.membershipId,
    firstDeliveryAt: pending.firstDeliveryAt,
    recurringTotalCents: pending.cycleTotalCents,
    taxTreatment: pending.automaticTaxEnabled
      ? "calculated_by_stripe"
      : "not_added",
  });
}

async function confirmStripeSessionExpired(
  stripe: Stripe,
  sessionId: string,
) {
  try {
    const expired = await stripe.checkout.sessions.expire(sessionId);
    return expired.status === "expired";
  } catch {
    const current = await stripe.checkout.sessions.retrieve(sessionId);
    return current.status === "expired";
  }
}

async function startBreadClubHostedCheckout(input: {
  checkout: ParsedBreadClubCheckout;
  consentVersion: string;
  pending: PendingBreadClubCheckout;
  stripe: Stripe;
}) {
  const { checkout, consentVersion, pending, stripe } = input;
  const checkoutExpiresAt = Math.floor(
    new Date(pending.checkoutExpiresAt).getTime() / 1000,
  );
  if (!Number.isSafeInteger(checkoutExpiresAt)) {
    throw new BreadClubCheckoutStartFailure(
      "Bread Club checkout expiration is invalid.",
      false,
    );
  }
  const currentTime = Math.floor(Date.now() / 1000);
  if (checkoutExpiresAt <= currentTime) {
    const released = await markBreadClubCheckoutIncomplete(
      pending.membershipId,
      pending.cycleId,
    );
    throw new BreadClubCheckoutStartFailure(
      "That checkout attempt expired. Please start checkout again.",
      released,
    );
  }
  if (checkoutExpiresAt < currentTime + 30 * 60) {
    throw new BreadClubCheckoutStartFailure(
      "That checkout is still being reconciled. Please try again after its payment link expires.",
      false,
    );
  }

  let session: Stripe.Checkout.Session | undefined;
  try {
    const automaticTaxEnabled = pending.automaticTaxEnabled;
    const stripeCustomer = automaticTaxEnabled
      ? await createStripeDeliveryCustomer(
          stripe,
          {
            name: checkout.customer.name,
            email: checkout.customer.email,
            phone: checkout.customer.phone,
            address: checkout.address,
            metadata: {
              bread_club_membership_id: pending.membershipId,
              customer_source: "bread_club_checkout",
            },
          },
          {
            idempotencyKey: `bread-club-customer-${checkout.checkoutAttemptId}`,
          },
        )
      : null;
    session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        expires_at: checkoutExpiresAt,
        ...(stripeCustomer
          ? { customer: stripeCustomer.id }
          : { customer_email: checkout.customer.email }),
        phone_number_collection: { enabled: true },
        line_items: [
          { price: pending.planStripePriceId, quantity: 1 },
          { price: pending.deliveryStripePriceId, quantity: 1 },
        ],
        automatic_tax: { enabled: automaticTaxEnabled },
        success_url: `${getSiteUrl()}/bread-club/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${getSiteUrl()}/api/bread-club/cancel-checkout?membership_id=${pending.membershipId}&token=${pending.checkoutCancelToken}`,
        metadata: {
          checkout_kind: "bread_club_subscription",
          bread_club_membership_id: pending.membershipId,
          bread_club_cycle_id: pending.cycleId,
          bread_club_plan_id: checkout.planId,
          bread_club_checkout_attempt_id: checkout.checkoutAttemptId,
          delivery_band: pending.routeBandKey,
          consent_version: consentVersion,
        },
        subscription_data: {
          metadata: {
            checkout_kind: "bread_club_subscription",
            bread_club_membership_id: pending.membershipId,
            bread_club_plan_id: checkout.planId,
            delivery_band: pending.routeBandKey,
          },
        },
      },
      {
        idempotencyKey: `bread-club-subscription-${checkout.checkoutAttemptId}`,
      },
    );
    await attachStripeSubscriptionCheckout(pending.membershipId, session.id);
    if (session.status === "complete") {
      return `${getSiteUrl()}/bread-club/success?session_id=${encodeURIComponent(session.id)}`;
    }
    if (session.status === "expired" || !session.url) {
      throw new Error("Stripe Checkout did not return an open payment link.");
    }
    return session.url;
  } catch (error) {
    let resetCheckoutAttempt = false;
    if (session?.id) {
      try {
        if (await confirmStripeSessionExpired(stripe, session.id)) {
          await attachStripeSubscriptionCheckout(
            pending.membershipId,
            session.id,
          );
          resetCheckoutAttempt = Boolean(
            await expireBreadClubCheckoutSession(
              session.id,
              pending.membershipId,
            ),
          );
        }
      } catch (cleanupError) {
        console.error("[bread-club] Stripe checkout cleanup deferred", {
          membershipId: pending.membershipId,
          sessionId: session.id,
          cleanupError,
        });
      }
    } else {
      console.error(
        "[bread-club] Stripe checkout creation outcome is uncertain",
        {
          membershipId: pending.membershipId,
          checkoutAttemptId: checkout.checkoutAttemptId,
          error,
        },
      );
    }
    throw new BreadClubCheckoutStartFailure(
      error instanceof Error
        ? error.message
        : "Stripe enrollment checkout could not be started.",
      resetCheckoutAttempt,
    );
  }
}

function requestIdentity(request: Request, email: string) {
  const ip = getRequestClientIp(request);
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
  const rateLimit = await checkRateLimitChain(
    {
      scope: "bread_club_checkout_ip",
      key: getRequestClientIp(request),
      limit: 12,
      windowMs: 60 * 60 * 1000,
    },
    {
      scope: "bread_club_checkout",
      key: identity.rateLimitKey,
      limit: 4,
      windowMs: 60 * 60 * 1000,
    },
  );
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

  const checkoutRequestHash = buildBreadClubCheckoutRequestHash(checkout);
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      {
        error:
          "Bread Club billing is not ready yet. No enrollment charge was created.",
      },
      { status: 503 },
    );
  }

  let existingAttempt;
  try {
    existingAttempt = await getExistingBreadClubCheckoutAttempt(
      checkout.checkoutAttemptId,
      checkoutRequestHash,
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Bread Club checkout attempt could not be verified.",
      },
      { status: 409 },
    );
  }

  if (existingAttempt) {
    if (existingAttempt.status !== "pending_checkout") {
      if (
        existingAttempt.status === "active" &&
        existingAttempt.stripeCheckoutSessionId
      ) {
        return checkoutResponse(
          `${getSiteUrl()}/bread-club/success?session_id=${encodeURIComponent(existingAttempt.stripeCheckoutSessionId)}`,
          existingAttempt.pending,
        );
      }
      return NextResponse.json(
        {
          error: "That checkout attempt is closed. Please start checkout again.",
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
          return checkoutResponse(
            existingSession.url,
            existingAttempt.pending,
          );
        }
        if (existingSession.status === "complete") {
          return checkoutResponse(
            `${getSiteUrl()}/bread-club/success?session_id=${encodeURIComponent(existingSession.id)}`,
            existingAttempt.pending,
          );
        }
        if (existingSession.status === "expired") {
          await expireBreadClubCheckoutSession(
            existingSession.id,
            existingAttempt.pending.membershipId,
          );
          return NextResponse.json(
            {
              error:
                "That checkout attempt expired. Please start checkout again.",
              resetCheckoutAttempt: true,
            },
            { status: 409 },
          );
        }
        throw new Error("Stripe Checkout is not in a reusable state.");
      } catch (error) {
        return NextResponse.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Existing Bread Club checkout could not be resumed.",
          },
          { status: 502 },
        );
      }
    }

    const canonicalConsentText = buildBreadClubConsentText(
      existingAttempt.pending.cycleTotalCents,
      existingAttempt.pending.automaticTaxEnabled,
    );
    if (checkout.consentText !== canonicalConsentText) {
      return NextResponse.json(
        {
          error:
            "The Bread Club total or renewal terms changed. Review the authorization and check it again.",
          resetCheckoutAttempt: false,
        },
        { status: 409 },
      );
    }

    try {
      const checkoutUrl = await startBreadClubHostedCheckout({
        checkout,
        consentVersion: existingAttempt.consentVersion,
        pending: existingAttempt.pending,
        stripe,
      });
      return checkoutResponse(
        checkoutUrl,
        existingAttempt.pending,
      );
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Stripe enrollment checkout could not be started.",
          resetCheckoutAttempt:
            error instanceof BreadClubCheckoutStartFailure
              ? error.resetCheckoutAttempt
              : false,
        },
        { status: 500 },
      );
    }
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

  const currentPlanPrice =
    plan.stripePriceId && plan.stripePriceCents === plan.priceCents;
  const currentDeliveryPrice =
    deliveryPrice.stripePriceId &&
    deliveryPrice.stripePriceCents === deliveryPrice.priceCents;
  if (!currentPlanPrice || !currentDeliveryPrice) {
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
  const automaticTaxEnabled = isBreadClubAutomaticTaxEnabled();
  const canonicalConsentText = buildBreadClubConsentText(
    cycleTotalCents,
    automaticTaxEnabled,
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

  let pending: PendingBreadClubCheckout;
  try {
    pending = await createPendingBreadClubCheckout({
      checkout: {
        ...checkout,
        consentText: canonicalConsentText,
      },
      consentIpHash: identity.ipHash,
      consentVersion: enrollment.settings.consentVersion,
      checkoutRequestHash,
      automaticTaxEnabled,
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
    const checkoutUrl = await startBreadClubHostedCheckout({
      checkout,
      consentVersion: enrollment.settings.consentVersion,
      pending,
      stripe,
    });
    return checkoutResponse(
      checkoutUrl,
      pending,
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Stripe enrollment checkout could not be started.",
        resetCheckoutAttempt:
          error instanceof BreadClubCheckoutStartFailure
            ? error.resetCheckoutAttempt
            : false,
      },
      { status: 500 },
    );
  }
}
