import type Stripe from "stripe";
import {
  sendBreadClubOwnerAlert,
  sendBreadClubPaymentFailure,
  sendBreadClubRenewal,
  sendBreadClubWelcome,
} from "./emails";
import {
  activateBreadClubCycleForInvoice,
  attachStripeSubscriptionCheckout,
  expireBreadClubCheckoutSession,
  findBreadClubCycleByInvoiceId,
  findPendingCycleForMembership,
  markBreadClubInvoiceFailed,
  prepareNextBreadClubCycle,
  recordBreadClubCheckoutCompleted,
  releaseBreadClubPendingCycle,
} from "./records";
import {
  markInvoiceDeliveryCreditsApplied,
  refundBreadClubUnusedCredits,
} from "./billing";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { getSiteUrl } from "@/lib/utils";
import { sendOwnerAlert } from "@/lib/owner-alerts";
import {
  completeBreadClubAddonCheckout,
  expireBreadClubAddonCheckout,
} from "./member-actions";

function stripeId(
  value:
    | string
    | { id: string }
    | null
    | undefined,
) {
  return typeof value === "string" ? value : value?.id || null;
}

function invoiceSubscriptionDetails(invoice: Stripe.Invoice) {
  return invoice.parent?.subscription_details || null;
}

function invoiceMembershipId(invoice: Stripe.Invoice) {
  return (
    invoiceSubscriptionDetails(invoice)?.metadata
      ?.bread_club_membership_id || null
  );
}

function subscriptionMembershipId(subscription: Stripe.Subscription) {
  return subscription.metadata.bread_club_membership_id || null;
}

function eventObjectId(event: Stripe.Event) {
  const object = event.data.object as { id?: string };
  return object.id || null;
}

export function isBreadClubStripeEvent(event: Stripe.Event) {
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded" ||
    event.type === "checkout.session.async_payment_failed" ||
    event.type === "checkout.session.expired"
  ) {
    const session = event.data.object as Stripe.Checkout.Session;
    return (
      session.metadata?.checkout_kind === "bread_club_subscription" ||
      session.metadata?.checkout_kind === "bread_club_addon"
    );
  }

  if (
    event.type === "invoice.paid" ||
    event.type === "invoice.payment_failed" ||
    event.type === "invoice.upcoming"
  ) {
    return Boolean(
      invoiceMembershipId(event.data.object as Stripe.Invoice),
    );
  }

  if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    return Boolean(
      subscriptionMembershipId(
        event.data.object as Stripe.Subscription,
      ),
    );
  }

  return false;
}

async function claimEvent(event: Stripe.Event) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { data, error } = await supabase.rpc("claim_stripe_event", {
    p_event_id: event.id,
    p_event_type: event.type,
    p_object_id: eventObjectId(event),
  });
  if (error) throw new Error(error.message);
  return data ? String(data) : null;
}

async function finishEvent(
  eventId: string,
  claimToken: string,
  status: "processed" | "failed",
  errorMessage?: string,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { data, error } = await supabase.rpc("finish_stripe_event", {
    p_event_id: eventId,
    p_claim_token: claimToken,
    p_status: status,
    p_error_message: errorMessage || null,
  });
  if (error) throw new Error(error.message);
  if (!data) {
    console.warn("[bread-club] stale Stripe event worker ignored", { eventId });
  }
}

function subscriptionItemDetails(subscription: Stripe.Subscription) {
  const planItem = subscription.items.data.find(
    (item) => Boolean(item.price.metadata.bread_club_plan_id),
  );
  const deliveryItem = subscription.items.data.find(
    (item) => Boolean(item.price.metadata.bread_club_delivery_band),
  );
  const periodEnd = subscription.items.data.reduce(
    (latest, item) => Math.max(latest, item.current_period_end || 0),
    0,
  );

  return {
    planItemId: planItem?.id || null,
    deliveryItemId: deliveryItem?.id || null,
    currentPeriodEnd: periodEnd
      ? new Date(periodEnd * 1000).toISOString()
      : null,
  };
}

async function membershipNotificationData(
  membershipId: string,
  cycleId: string,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const [membershipResult, cycleResult, fulfillmentResult] =
    await Promise.all([
      supabase
        .from("bread_club_memberships")
        .select(
          "id, customers(name, email), bread_club_plans!bread_club_memberships_plan_id_fkey(name), first_delivery_at",
        )
        .eq("id", membershipId)
        .maybeSingle(),
      supabase
        .from("bread_club_cycles")
        .select("cycle_number, total_cents")
        .eq("id", cycleId)
        .maybeSingle(),
      supabase
        .from("bread_club_fulfillments")
        .select("order_id, delivery_windows(label, starts_at)")
        .eq("cycle_id", cycleId)
        .order("created_at", { ascending: true }),
    ]);
  if (membershipResult.error) throw new Error(membershipResult.error.message);
  if (cycleResult.error) throw new Error(cycleResult.error.message);
  if (fulfillmentResult.error) throw new Error(fulfillmentResult.error.message);

  const membership = membershipResult.data;
  const customer = Array.isArray(membership?.customers)
    ? membership?.customers[0]
    : membership?.customers;
  const plan = Array.isArray(membership?.bread_club_plans)
    ? membership?.bread_club_plans[0]
    : membership?.bread_club_plans;
  const sundayLabels = (fulfillmentResult.data || []).map((row) => {
    const window = Array.isArray(row.delivery_windows)
      ? row.delivery_windows[0]
      : row.delivery_windows;
    return String(window?.label || "Sunday 3:00-6:00 PM");
  });

  return {
    customerName: String(customer?.name || "Bread Club member"),
    customerEmail: String(customer?.email || ""),
    planName: String(plan?.name || "Sunday Bread Club"),
    cycleNumber: Number(cycleResult.data?.cycle_number || 1),
    totalCents: Number(cycleResult.data?.total_cents || 0),
    firstOrderId: String(fulfillmentResult.data?.[0]?.order_id || ""),
    sundayLabels,
  };
}

async function claimPaidCycleNotification(
  membershipId: string,
  cycleId: string,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const jobKey = `paid-cycle-notification:${cycleId}`;
  const { data, error } = await supabase.rpc("claim_bread_club_job", {
    p_job_key: jobKey,
    p_job_type: "paid_cycle_notification",
    p_membership_id: membershipId,
    p_payload: { cycle_id: cycleId },
  });
  if (error) throw new Error(error.message);
  return { claimToken: data ? String(data) : null, jobKey };
}

async function finishPaidCycleNotification(
  jobKey: string,
  claimToken: string,
  status: "completed" | "failed",
  error?: unknown,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return;
  const errorMessage =
    status === "failed"
      ? error instanceof Error
        ? error.message
        : String(error || "Paid-cycle notification failed.")
      : null;
  const { data, error: updateError } = await supabase.rpc(
    "finish_bread_club_job",
    {
      p_job_key: jobKey,
      p_claim_token: claimToken,
      p_status: status,
      p_error_message: errorMessage,
    },
  );
  if (updateError) throw new Error(updateError.message);
  if (!data) {
    console.warn("[bread-club] stale notification worker ignored", { jobKey });
  }
}

async function notifyPaidCycle(
  membershipId: string,
  cycleId: string,
) {
  const claim = await claimPaidCycleNotification(membershipId, cycleId);
  if (!claim.claimToken) return;

  try {
    const notification = await membershipNotificationData(
      membershipId,
      cycleId,
    );
    if (!notification.customerEmail) {
      await finishPaidCycleNotification(
        claim.jobKey,
        claim.claimToken,
        "completed",
      );
      return;
    }
    const manageUrl = `${getSiteUrl()}/bread-club/manage`;

    if (notification.cycleNumber === 1) {
      const sends: Promise<unknown>[] = [
        sendBreadClubWelcome({
          to: notification.customerEmail,
          customerName: notification.customerName,
          membershipId,
          planName: notification.planName,
          recurringTotalCents: notification.totalCents,
          sundayLabels: notification.sundayLabels,
          manageUrl,
          eventKey: `paid-cycle:${cycleId}:welcome`,
        }),
        sendOwnerAlert({
          type: "order",
          customerName: notification.customerName,
          orderSummary: `${notification.planName}, four Sunday deliveries`,
          notes: `Paid Bread Club membership. First delivery: ${
            notification.sundayLabels[0] || "Next Sunday"
          }.`,
          orderId: notification.firstOrderId || undefined,
          throwOnFailure: true,
        }),
      ];

      if (process.env.BAKERY_EMAIL) {
        sends.push(
          sendBreadClubOwnerAlert({
            to: process.env.BAKERY_EMAIL,
            membershipId,
            customerName: notification.customerName,
            planName: notification.planName,
            amountCents: notification.totalCents,
            firstDeliveryLabel:
              notification.sundayLabels[0] || "Next Sunday",
            eventKey: `paid-cycle:${cycleId}:bakery-alert`,
          }),
        );
      }

      const results = await Promise.allSettled(sends);
      const failures = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (failures.length) {
        throw new AggregateError(
          failures.map((failure) => failure.reason),
          "One or more paid-cycle notifications failed.",
        );
      }
      await finishPaidCycleNotification(
        claim.jobKey,
        claim.claimToken,
        "completed",
      );
      return;
    }

    await sendBreadClubRenewal({
      to: notification.customerEmail,
      customerName: notification.customerName,
      membershipId,
      planName: notification.planName,
      amountCents: notification.totalCents,
      sundayLabels: notification.sundayLabels,
      manageUrl,
      eventKey: `paid-cycle:${cycleId}:renewal`,
    });
    await finishPaidCycleNotification(
      claim.jobKey,
      claim.claimToken,
      "completed",
    );
  } catch (error) {
    await finishPaidCycleNotification(
      claim.jobKey,
      claim.claimToken,
      "failed",
      error,
    );
    console.error("[bread-club] paid-cycle email failed", {
      membershipId,
      cycleId,
      error,
    });
    throw error;
  }
}

export type BreadClubSubscriptionCheckoutReconciliation = {
  membershipId: string;
  cycleId: string;
  checkoutRecorded: true;
  cycleState: "awaiting_payment" | "activated" | "already_activated";
};

type ExpectedBreadClubCheckout = {
  membershipId?: string;
  cycleId?: string;
};

export async function reconcileBreadClubSubscriptionCheckout(
  session: Stripe.Checkout.Session,
  expected: ExpectedBreadClubCheckout = {},
): Promise<BreadClubSubscriptionCheckoutReconciliation> {
  const membershipId =
    session.metadata?.bread_club_membership_id || "";
  const cycleId = session.metadata?.bread_club_cycle_id || "";
  if (
    session.status !== "complete" ||
    session.mode !== "subscription" ||
    session.metadata?.checkout_kind !== "bread_club_subscription" ||
    !membershipId ||
    !cycleId
  ) {
    throw new Error(
      "Stripe Checkout did not contain a complete Bread Club subscription payment boundary.",
    );
  }
  if (
    (expected.membershipId && expected.membershipId !== membershipId) ||
    (expected.cycleId && expected.cycleId !== cycleId)
  ) {
    throw new Error(
      "Stripe Checkout metadata did not match the pending Bread Club checkout.",
    );
  }

  const stripe = getStripe();
  if (!stripe) throw new Error("STRIPE_SECRET_KEY is not configured.");
  const subscriptionId = stripeId(session.subscription);
  if (!subscriptionId) {
    throw new Error(
      "Completed Bread Club Checkout did not contain a subscription.",
    );
  }
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["latest_invoice"],
  });
  if (
    subscription.metadata.checkout_kind !== "bread_club_subscription" ||
    subscriptionMembershipId(subscription) !== membershipId
  ) {
    throw new Error(
      "Stripe subscription metadata did not match the Bread Club checkout.",
    );
  }
  const itemDetails = subscriptionItemDetails(subscription);

  await attachStripeSubscriptionCheckout(membershipId, session.id);

  await recordBreadClubCheckoutCompleted({
    membershipId,
    sessionId: session.id,
    stripeCustomerId: stripeId(session.customer),
    stripeSubscriptionId: subscriptionId,
    planSubscriptionItemId: itemDetails.planItemId,
    deliverySubscriptionItemId: itemDetails.deliveryItemId,
    currentPeriodEnd: itemDetails.currentPeriodEnd,
  });

  const latestInvoice =
    subscription?.latest_invoice &&
    typeof subscription.latest_invoice !== "string"
      ? subscription.latest_invoice
      : null;
  if (
    session.payment_status !== "paid" &&
    session.payment_status !== "no_payment_required"
  ) {
    return {
      membershipId,
      cycleId,
      checkoutRecorded: true,
      cycleState: "awaiting_payment",
    };
  }
  if (!latestInvoice || latestInvoice.status !== "paid") {
    throw new Error(
      "Completed Bread Club Checkout did not have a paid Stripe invoice.",
    );
  }
  const invoiceMetadataMembershipId = invoiceMembershipId(latestInvoice);
  if (
    invoiceMetadataMembershipId &&
    invoiceMetadataMembershipId !== membershipId
  ) {
    throw new Error(
      "Stripe invoice metadata did not match the Bread Club checkout.",
    );
  }

  const existingCycle = await findBreadClubCycleByInvoiceId(
    latestInvoice.id,
  );
  let cycleState: BreadClubSubscriptionCheckoutReconciliation["cycleState"] =
    "activated";
  if (existingCycle) {
    if (
      existingCycle.id !== cycleId ||
      existingCycle.membershipId !== membershipId
    ) {
      throw new Error(
        "The paid Stripe invoice is already attached to a different Bread Club cycle.",
      );
    }
    if (["paid", "completed"].includes(existingCycle.status)) {
      cycleState = "already_activated";
    } else if (
      !["pending_payment", "past_due"].includes(existingCycle.status)
    ) {
      throw new Error(
        `Bread Club cycle ${cycleId} cannot be activated from ${existingCycle.status}.`,
      );
    }
  } else {
    const pending = await findPendingCycleForMembership(membershipId);
    if (pending?.id !== cycleId) {
      throw new Error(
        "The paid Stripe Checkout did not match the membership's pending Bread Club cycle.",
      );
    }
  }

  await activateBreadClubCycleForInvoice({
    membershipId,
    cycleId,
    invoiceId: latestInvoice.id,
    amountPaidCents: latestInvoice.amount_paid,
    taxCents:
      latestInvoice.total_taxes?.reduce(
        (sum, tax) => sum + tax.amount,
        0,
      ) || 0,
    paidAt: latestInvoice.status_transitions.paid_at
      ? new Date(
          latestInvoice.status_transitions.paid_at * 1000,
        ).toISOString()
      : undefined,
  });
  await notifyPaidCycle(membershipId, cycleId);
  return {
    membershipId,
    cycleId,
    checkoutRecorded: true,
    cycleState,
  };
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const membershipId = invoiceMembershipId(invoice);
  if (!membershipId) return;
  const existingCycle = await findBreadClubCycleByInvoiceId(invoice.id);
  if (
    existingCycle &&
    existingCycle.membershipId !== membershipId
  ) {
    throw new Error(
      "Stripe invoice metadata did not match its Bread Club cycle.",
    );
  }
  if (
    existingCycle &&
    ["paid", "completed"].includes(existingCycle.status)
  ) {
    await activateBreadClubCycleForInvoice({
      membershipId,
      cycleId: existingCycle.id,
      invoiceId: invoice.id,
      amountPaidCents: invoice.amount_paid,
      taxCents:
        invoice.total_taxes?.reduce(
          (sum, tax) => sum + tax.amount,
          0,
        ) || 0,
      paidAt: invoice.status_transitions.paid_at
        ? new Date(
            invoice.status_transitions.paid_at * 1000,
          ).toISOString()
        : undefined,
    });
    await markInvoiceDeliveryCreditsApplied(membershipId, invoice);
    await notifyPaidCycle(membershipId, existingCycle.id);
    return;
  }
  if (
    existingCycle &&
    ["refund_pending", "refunded"].includes(existingCycle.status)
  ) {
    await markInvoiceDeliveryCreditsApplied(membershipId, invoice);
    return;
  }
  if (existingCycle?.status === "canceled") {
    throw new Error(
      `Bread Club cycle ${existingCycle.id} is canceled, but Stripe reported invoice ${invoice.id} as paid. Manual reconciliation is required.`,
    );
  }
  let cycle = await findPendingCycleForMembership(membershipId);
  if (!cycle) {
    cycle = await prepareNextBreadClubCycle(membershipId);
  }

  await activateBreadClubCycleForInvoice({
    membershipId,
    cycleId: cycle.id,
    invoiceId: invoice.id,
    amountPaidCents: invoice.amount_paid,
    taxCents:
      invoice.total_taxes?.reduce((sum, tax) => sum + tax.amount, 0) || 0,
    paidAt: invoice.status_transitions.paid_at
      ? new Date(invoice.status_transitions.paid_at * 1000).toISOString()
      : undefined,
  });
  await markInvoiceDeliveryCreditsApplied(membershipId, invoice);
  await notifyPaidCycle(membershipId, cycle.id);
}

async function handleInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  eventId: string,
) {
  const membershipId = invoiceMembershipId(invoice);
  if (!membershipId) return;
  await markBreadClubInvoiceFailed(membershipId, invoice.id);

  const supabase = getSupabaseAdminClient();
  if (!supabase) return;
  const { data } = await supabase
    .from("bread_club_memberships")
    .select("customers(name, email)")
    .eq("id", membershipId)
    .maybeSingle();
  const customer = Array.isArray(data?.customers)
    ? data?.customers[0]
    : data?.customers;
  if (!customer?.email) return;
  try {
    await sendBreadClubPaymentFailure({
      to: String(customer.email),
      customerName: String(customer.name || "there"),
      membershipId,
      portalUrl: `${getSiteUrl()}/bread-club/manage`,
      eventKey: `stripe-event:${eventId}:payment-failure`,
    });
  } catch (error) {
    console.error("[bread-club] payment-failure email failed", error);
  }
}

async function handleSubscriptionUpdate(
  subscription: Stripe.Subscription,
  deleted = false,
) {
  const membershipId = subscriptionMembershipId(subscription);
  if (!membershipId) return;
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const details = subscriptionItemDetails(subscription);
  const status = deleted
    ? "canceled"
    : subscription.status === "past_due" ||
        subscription.status === "unpaid"
      ? "past_due"
      : subscription.cancel_at_period_end
        ? "canceling"
        : subscription.status === "active" ||
            subscription.status === "trialing"
          ? "active"
          : "incomplete";

  const { error } = await supabase
    .from("bread_club_memberships")
    .update({
      status,
      cancel_at_period_end: subscription.cancel_at_period_end || deleted,
      canceled_at:
        deleted || subscription.canceled_at
          ? new Date(
              (subscription.canceled_at || Math.floor(Date.now() / 1000)) *
                1000,
            ).toISOString()
          : null,
      stripe_plan_subscription_item_id: details.planItemId,
      stripe_delivery_subscription_item_id: details.deliveryItemId,
      stripe_current_period_end: details.currentPeriodEnd,
      updated_at: new Date().toISOString(),
    })
    .eq("id", membershipId);
  if (error) throw new Error(error.message);

  if (subscription.cancel_at_period_end || deleted) {
    const pending = await findPendingCycleForMembership(membershipId);
    if (pending) await releaseBreadClubPendingCycle(pending.id);
  }

  if (deleted) await refundBreadClubUnusedCredits(membershipId);
}

async function processEvent(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      if (
        (event.data.object as Stripe.Checkout.Session).metadata
          ?.checkout_kind === "bread_club_addon"
      ) {
        await completeBreadClubAddonCheckout(
          event.data.object as Stripe.Checkout.Session,
        );
      } else {
        await reconcileBreadClubSubscriptionCheckout(
          event.data.object as Stripe.Checkout.Session,
        );
      }
      break;
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.metadata?.checkout_kind === "bread_club_addon") {
        await expireBreadClubAddonCheckout(
          session.id,
          session.metadata?.bread_club_addon_id || null,
        );
      } else {
        await expireBreadClubCheckoutSession(
          session.id,
          session.metadata?.bread_club_membership_id || null,
        );
      }
      break;
    }
    case "invoice.paid":
      await handleInvoicePaid(event.data.object as Stripe.Invoice);
      break;
    case "invoice.payment_failed":
      await handleInvoicePaymentFailed(
        event.data.object as Stripe.Invoice,
        event.id,
      );
      break;
    case "invoice.upcoming": {
      const membershipId = invoiceMembershipId(
        event.data.object as Stripe.Invoice,
      );
      if (membershipId) {
        const supabase = getSupabaseAdminClient();
        if (!supabase) {
          throw new Error("Supabase admin client is not configured.");
        }
        const { data: membership, error } = await supabase
          .from("bread_club_memberships")
          .select(
            "status, cancel_at_period_end, provider_sync_required",
          )
          .eq("id", membershipId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (
          membership &&
          ["active", "past_due"].includes(String(membership.status)) &&
          !membership.cancel_at_period_end &&
          !membership.provider_sync_required
        ) {
          await prepareNextBreadClubCycle(membershipId);
        }
      }
      break;
    }
    case "customer.subscription.updated":
      await handleSubscriptionUpdate(
        event.data.object as Stripe.Subscription,
      );
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionUpdate(
        event.data.object as Stripe.Subscription,
        true,
      );
      break;
  }
}

export async function handleBreadClubStripeEvent(event: Stripe.Event) {
  if (!isBreadClubStripeEvent(event)) return false;
  const claimToken = await claimEvent(event);
  if (!claimToken) return true;

  try {
    await processEvent(event);
    await finishEvent(event.id, claimToken, "processed");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Bread Club webhook failed.";
    await finishEvent(event.id, claimToken, "failed", message);
    throw error;
  }
  return true;
}
