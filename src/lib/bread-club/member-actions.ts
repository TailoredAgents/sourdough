import { format } from "date-fns";
import type Stripe from "stripe";
import { checkDeliveryAddressWithRoutes } from "@/lib/delivery";
import { getDeliverySettingsData } from "@/lib/storefront-data";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdminClient } from "@/lib/supabase";
import type { DeliveryAddress } from "@/lib/types";
import { getSiteUrl } from "@/lib/utils";
import { isBreadClubAutomaticTaxEnabled } from "./config";
import { getBreadClubCatalogData } from "./data";
import {
  sendBreadClubCancellation,
  sendBreadClubAddonReceipt,
  sendBreadClubPlanChange,
  sendBreadClubSkipCredit,
} from "./emails";
import { getBreadClubMemberData } from "./member-data";
import {
  findBreadClubDeliveryPrice,
  normalizeBreadClubSelection,
  validateBreadClubSelection,
} from "./pricing";
import {
  findPendingCycleForMembership,
  releaseBreadClubPendingCycle,
} from "./records";
import type { BreadClubSelection } from "./types";

async function assertRenewalNotReserved(membershipId: string) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { count, error } = await supabase
    .from("bread_club_cycles")
    .select("id", { count: "exact", head: true })
    .eq("membership_id", membershipId)
    .in("status", ["pending_payment", "past_due"]);
  if (error) throw new Error(error.message);
  if ((count || 0) > 0) {
    throw new Error(
      "The next renewal is already reserved. Contact the bakery to change this cycle.",
    );
  }
}

export async function changeBreadClubSelection(
  membershipId: string,
  fulfillmentId: string,
  selection: BreadClubSelection[],
) {
  const member = await getBreadClubMemberData(membershipId);
  if (!member) throw new Error("Bread Club membership was not found.");
  const fulfillment = member.fulfillments.find(
    (item) => item.id === fulfillmentId,
  );
  if (!fulfillment) throw new Error("That Sunday delivery was not found.");

  const normalized = normalizeBreadClubSelection(selection);
  const selectionError = validateBreadClubSelection(
    member.plan,
    normalized,
  );
  if (selectionError) throw new Error(selectionError);

  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { error } = await supabase.rpc("swap_bread_club_selection", {
    p_fulfillment_id: fulfillmentId,
    p_selection: normalized.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity,
    })),
  });
  if (error) throw new Error(error.message);
  return getBreadClubMemberData(membershipId);
}

export async function skipBreadClubDelivery(
  membershipId: string,
  fulfillmentId: string,
) {
  const member = await getBreadClubMemberData(membershipId);
  if (!member) throw new Error("Bread Club membership was not found.");
  const fulfillment = member.fulfillments.find(
    (item) => item.id === fulfillmentId,
  );
  if (!fulfillment) throw new Error("That Sunday delivery was not found.");
  if (!member.stripeCustomerId || !member.stripeSubscriptionId) {
    throw new Error("Subscription billing is not connected for this membership.");
  }

  const supabase = getSupabaseAdminClient();
  const stripe = getStripe();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  if (!stripe) throw new Error("Stripe is not configured.");

  const { data, error } = await supabase.rpc(
    "skip_bread_club_fulfillment",
    { p_fulfillment_id: fulfillmentId },
  );
  if (error) throw new Error(error.message);
  const credit = data as {
    credit_id: string;
    quantity: number;
    delivery_fee_credit_cents: number;
  };

  let invoiceItemId: string | null = null;
  try {
    const invoiceItem = await stripe.invoiceItems.create({
      customer: member.stripeCustomerId,
      subscription: member.stripeSubscriptionId,
      amount: -Number(credit.delivery_fee_credit_cents),
      currency: "usd",
      description: `Bread Club delivery credit for ${fulfillment.deliveryLabel}`,
      discountable: false,
      metadata: {
        bread_club_membership_id: membershipId,
        bread_club_rollover_credit_id: String(credit.credit_id),
      },
    });
    invoiceItemId = invoiceItem.id;
    await supabase
      .from("bread_club_rollover_credits")
      .update({
        stripe_invoice_item_id: invoiceItem.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", credit.credit_id);
  } catch (error) {
    console.error("[bread-club] skip invoice credit needs reconciliation", {
      membershipId,
      creditId: credit.credit_id,
      error,
    });
  }

  try {
    const expiresAt = new Date(
      Date.now() + 60 * 24 * 60 * 60 * 1000,
    );
    await sendBreadClubSkipCredit({
      to: member.customerEmail,
      customerName: member.customerName,
      membershipId,
      skippedDelivery: fulfillment.deliveryLabel,
      loafQuantity: Number(credit.quantity),
      deliveryCreditCents: Number(credit.delivery_fee_credit_cents),
      expiresLabel: format(expiresAt, "MMMM d, yyyy"),
      manageUrl: `${getSiteUrl()}/bread-club/manage`,
    });
  } catch (error) {
    console.error("[bread-club] skip email failed", error);
  }

  return {
    member: await getBreadClubMemberData(membershipId),
    billingCreditPending: !invoiceItemId,
  };
}

export async function redeemBreadClubCredit(
  membershipId: string,
  creditId: string,
  fulfillmentId: string,
  productId: string,
) {
  const member = await getBreadClubMemberData(membershipId);
  if (!member) throw new Error("Bread Club membership was not found.");
  if (!member.credits.some((credit) => credit.id === creditId)) {
    throw new Error("That rollover credit was not found.");
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { error } = await supabase.rpc("redeem_bread_club_credit", {
    p_credit_id: creditId,
    p_fulfillment_id: fulfillmentId,
    p_product_id: productId,
  });
  if (error) throw new Error(error.message);
  return getBreadClubMemberData(membershipId);
}

export async function scheduleBreadClubPlanChange(
  membershipId: string,
  planId: string,
  selection: BreadClubSelection[],
) {
  const [member, catalog] = await Promise.all([
    getBreadClubMemberData(membershipId),
    getBreadClubCatalogData(),
  ]);
  if (!member) throw new Error("Bread Club membership was not found.");
  await assertRenewalNotReserved(membershipId);
  const plan = catalog.plans.find(
    (item) => item.id === planId && item.active,
  );
  if (
    !plan ||
    !plan.stripePriceId ||
    plan.stripePriceCents !== plan.priceCents
  ) {
    throw new Error("That Bread Club plan is not ready for enrollment.");
  }
  const normalized = normalizeBreadClubSelection(selection);
  const selectionError = validateBreadClubSelection(plan, normalized);
  if (selectionError) throw new Error(selectionError);

  const supabase = getSupabaseAdminClient();
  const stripe = getStripe();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  if (!stripe) throw new Error("Stripe is not configured.");

  const { data: membership, error: membershipError } = await supabase
    .from("bread_club_memberships")
    .select("stripe_plan_subscription_item_id, default_selection")
    .eq("id", membershipId)
    .maybeSingle();
  if (membershipError) throw new Error(membershipError.message);
  if (!membership?.stripe_plan_subscription_item_id) {
    throw new Error("The subscription plan item is not connected.");
  }

  const { error: updateError } = await supabase
    .from("bread_club_memberships")
    .update({
      pending_plan_id: plan.id,
      default_selection: normalized.map((item) => ({
        product_id: item.productId,
        quantity: item.quantity,
      })),
      updated_at: new Date().toISOString(),
    })
    .eq("id", membershipId);
  if (updateError) throw new Error(updateError.message);

  try {
    await stripe.subscriptionItems.update(
      String(membership.stripe_plan_subscription_item_id),
      {
        price: plan.stripePriceId,
        proration_behavior: "none",
      },
    );
  } catch (error) {
    await supabase
      .from("bread_club_memberships")
      .update({
        pending_plan_id: null,
        default_selection: membership.default_selection,
        updated_at: new Date().toISOString(),
      })
      .eq("id", membershipId);
    throw error;
  }

  try {
    await sendBreadClubPlanChange({
      to: member.customerEmail,
      customerName: member.customerName,
      membershipId,
      newPlanName: plan.name,
      effectiveLabel: "with the next four-week billing cycle",
    });
  } catch (error) {
    console.error("[bread-club] plan-change email failed", error);
  }
  return getBreadClubMemberData(membershipId);
}

export async function updateBreadClubAddress(
  membershipId: string,
  address: DeliveryAddress,
  deliveryInstructions: string,
) {
  const [member, settings, catalog] = await Promise.all([
    getBreadClubMemberData(membershipId),
    getDeliverySettingsData(),
    getBreadClubCatalogData(),
  ]);
  if (!member) throw new Error("Bread Club membership was not found.");
  await assertRenewalNotReserved(membershipId);
  const lockedDelivery = member.fulfillments.find(
    (fulfillment) =>
      fulfillment.status === "scheduled" &&
      new Date(fulfillment.cutoffAt).getTime() <= Date.now() &&
      new Date(fulfillment.deliveryStartsAt).getTime() > Date.now(),
  );
  if (lockedDelivery) {
    throw new Error(
      "This Sunday's route is already locked. Contact the bakery to change the address.",
    );
  }

  const deliveryCheck = await checkDeliveryAddressWithRoutes(
    address,
    settings,
  );
  if (!deliveryCheck.eligible || deliveryCheck.preliminary) {
    throw new Error(
      deliveryCheck.message ||
        "That address could not be confirmed for delivery.",
    );
  }
  const deliveryPrice = findBreadClubDeliveryPrice(
    catalog.deliveryPrices,
    deliveryCheck.durationMinutes,
    deliveryCheck.feeCents,
  );
  if (
    !deliveryPrice ||
    !deliveryPrice.stripePriceId ||
    deliveryPrice.stripePriceCents !== deliveryPrice.priceCents
  ) {
    throw new Error("The updated delivery price is not ready.");
  }

  const supabase = getSupabaseAdminClient();
  const stripe = getStripe();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  if (!stripe) throw new Error("Stripe is not configured.");
  const { data: membership, error: lookupError } = await supabase
    .from("bread_club_memberships")
    .select("stripe_delivery_subscription_item_id")
    .eq("id", membershipId)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (!membership?.stripe_delivery_subscription_item_id) {
    throw new Error("The subscription delivery item is not connected.");
  }

  const addressWithContact = {
    ...address,
    email: member.customerEmail,
    phone: member.customerPhone,
  };
  const previousDeliveryPrice = catalog.deliveryPrices.find(
    (price) => price.bandKey === member.routeBandKey,
  );
  try {
    await stripe.subscriptionItems.update(
      String(membership.stripe_delivery_subscription_item_id),
      {
        price: deliveryPrice.stripePriceId,
        proration_behavior: "none",
      },
    );
    const { error: updateError } = await supabase.rpc(
      "update_bread_club_address",
      {
        p_membership_id: membershipId,
        p_delivery_address: addressWithContact,
        p_delivery_instructions: deliveryInstructions || null,
        p_delivery_check: deliveryCheck,
        p_route_fee_cents: deliveryCheck.feeCents,
        p_route_band_key: deliveryPrice.bandKey,
      },
    );
    if (updateError) throw new Error(updateError.message);
  } catch (error) {
    if (previousDeliveryPrice?.stripePriceId) {
      try {
        await stripe.subscriptionItems.update(
          String(membership.stripe_delivery_subscription_item_id),
          {
            price: previousDeliveryPrice.stripePriceId,
            proration_behavior: "none",
          },
        );
      } catch (rollbackError) {
        console.error("[bread-club] delivery price rollback failed", {
          membershipId,
          rollbackError,
        });
      }
    }
    throw error;
  }
  return getBreadClubMemberData(membershipId);
}

export async function cancelBreadClubMembership(
  membershipId: string,
  reason: string,
) {
  const member = await getBreadClubMemberData(membershipId);
  if (!member) throw new Error("Bread Club membership was not found.");
  if (!member.stripeSubscriptionId) {
    throw new Error("The Stripe subscription is not connected.");
  }
  const stripe = getStripe();
  const supabase = getSupabaseAdminClient();
  if (!stripe) throw new Error("Stripe is not configured.");
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  await stripe.subscriptions.update(member.stripeSubscriptionId, {
    cancel_at_period_end: true,
    metadata: {
      bread_club_membership_id: membershipId,
      cancellation_requested_in_app: "true",
    },
  });

  const pendingCycle = await findPendingCycleForMembership(membershipId);
  if (pendingCycle) {
    await releaseBreadClubPendingCycle(pendingCycle.id);
  }

  const { error } = await supabase
    .from("bread_club_memberships")
    .update({
      status: "canceling",
      cancel_at_period_end: true,
      canceled_at: new Date().toISOString(),
      cancellation_reason: reason || "Canceled online by member",
      updated_at: new Date().toISOString(),
    })
    .eq("id", membershipId);
  if (error) throw new Error(error.message);

  const lastDelivery =
    [...member.fulfillments]
      .filter((item) => item.status === "scheduled")
      .sort(
        (left, right) =>
          new Date(right.deliveryStartsAt).getTime() -
          new Date(left.deliveryStartsAt).getTime(),
      )[0]?.deliveryLabel || "your final paid Sunday";
  try {
    await sendBreadClubCancellation({
      to: member.customerEmail,
      customerName: member.customerName,
      membershipId,
      finalDeliveryLabel: lastDelivery,
    });
  } catch (emailError) {
    console.error("[bread-club] cancellation email failed", emailError);
  }
  return getBreadClubMemberData(membershipId);
}

type AddonItem = {
  productId: string;
  quantity: number;
};

export async function createBreadClubAddonCheckout(
  membershipId: string,
  fulfillmentId: string,
  items: AddonItem[],
) {
  const member = await getBreadClubMemberData(membershipId);
  if (!member) throw new Error("Bread Club membership was not found.");
  const fulfillment = member.fulfillments.find(
    (item) => item.id === fulfillmentId && item.status === "scheduled",
  );
  if (!fulfillment) throw new Error("Choose an upcoming Sunday delivery.");

  const supabase = getSupabaseAdminClient();
  const stripe = getStripe();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  if (!stripe) throw new Error("Stripe is not configured.");

  const normalized = new Map<string, number>();
  for (const item of items) {
    if (item.productId && Number.isInteger(item.quantity) && item.quantity > 0) {
      normalized.set(
        item.productId,
        (normalized.get(item.productId) || 0) + item.quantity,
      );
    }
  }
  const productIds = Array.from(normalized.keys());
  if (!productIds.length) throw new Error("Choose at least one add-on.");

  const { data: menuItems, error: itemError } = await supabase
    .from("weekly_menu_items")
    .select(
      "product_id, available_quantity, sold_quantity, unavailable, products(id, name, description, category, price_cents, stripe_price_id, stripe_price_cents, active)",
    )
    .eq("weekly_menu_id", fulfillment.weeklyMenuId)
    .in("product_id", productIds);
  if (itemError) throw new Error(itemError.message);

  const checkoutItems = productIds.map((productId) => {
    const menuItem = menuItems?.find(
      (item) => String(item.product_id) === productId,
    );
    const product = Array.isArray(menuItem?.products)
      ? menuItem?.products[0]
      : menuItem?.products;
    const quantity = normalized.get(productId) || 0;
    if (
      !menuItem ||
      !product ||
      product.category !== "add-on" ||
      !product.active ||
      menuItem.unavailable ||
      Number(menuItem.available_quantity) - Number(menuItem.sold_quantity) <
        quantity
    ) {
      throw new Error("One selected add-on is no longer available.");
    }
    if (
      !product.stripe_price_id ||
      Number(product.stripe_price_cents) !== Number(product.price_cents)
    ) {
      throw new Error(`${product.name} is not ready for Stripe checkout.`);
    }
    return {
      product_id: productId,
      quantity,
      unit_price_cents: Number(product.price_cents),
      stripe_price_id: String(product.stripe_price_id),
      name: String(product.name),
    };
  });
  const subtotalCents = checkoutItems.reduce(
    (sum, item) => sum + item.quantity * item.unit_price_cents,
    0,
  );

  const { data: addon, error: addonError } = await supabase
    .from("bread_club_addon_checkouts")
    .insert({
      membership_id: membershipId,
      fulfillment_id: fulfillmentId,
      items: checkoutItems,
      subtotal_cents: subtotalCents,
      status: "pending_payment",
    })
    .select("id")
    .single();
  if (addonError) throw new Error(addonError.message);
  const addonId = String(addon.id);

  const { error: reservationError } = await supabase.rpc(
    "reserve_bread_club_addon_inventory",
    { p_addon_checkout_id: addonId },
  );
  if (reservationError) {
    await supabase
      .from("bread_club_addon_checkouts")
      .delete()
      .eq("id", addonId);
    throw new Error(reservationError.message);
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: member.stripeCustomerId || undefined,
      customer_email: member.stripeCustomerId
        ? undefined
        : member.customerEmail,
      line_items: checkoutItems.map((item) => ({
        price: item.stripe_price_id,
        quantity: item.quantity,
      })),
      automatic_tax: { enabled: isBreadClubAutomaticTaxEnabled() },
      success_url: `${getSiteUrl()}/bread-club/manage?addon=success`,
      cancel_url: `${getSiteUrl()}/bread-club/manage?addon=canceled`,
      metadata: {
        checkout_kind: "bread_club_addon",
        bread_club_addon_id: addonId,
        bread_club_membership_id: membershipId,
        bread_club_fulfillment_id: fulfillmentId,
      },
    });
    const { error: updateError } = await supabase
      .from("bread_club_addon_checkouts")
      .update({
        stripe_checkout_session_id: session.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", addonId);
    if (updateError) throw new Error(updateError.message);
    return { url: session.url };
  } catch (error) {
    await supabase.rpc("release_bread_club_addon_inventory", {
      p_addon_checkout_id: addonId,
    });
    throw error;
  }
}

export async function completeBreadClubAddonCheckout(
  session: Stripe.Checkout.Session,
) {
  const addonId = session.metadata?.bread_club_addon_id;
  if (!addonId) return;
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { error } = await supabase.rpc(
    "complete_bread_club_addon_checkout",
    {
      p_addon_checkout_id: addonId,
      p_payment_intent_id:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id || null,
    },
  );
  if (error) throw new Error(error.message);

  const { data: addon, error: lookupError } = await supabase
    .from("bread_club_addon_checkouts")
    .select(
      "membership_id, subtotal_cents, items, bread_club_memberships(customers(name, email)), bread_club_fulfillments(delivery_windows(label))",
    )
    .eq("id", addonId)
    .maybeSingle();
  if (lookupError || !addon) return;
  const membership = Array.isArray(addon.bread_club_memberships)
    ? addon.bread_club_memberships[0]
    : addon.bread_club_memberships;
  const customer = Array.isArray(membership?.customers)
    ? membership?.customers[0]
    : membership?.customers;
  const fulfillment = Array.isArray(addon.bread_club_fulfillments)
    ? addon.bread_club_fulfillments[0]
    : addon.bread_club_fulfillments;
  const window = Array.isArray(fulfillment?.delivery_windows)
    ? fulfillment?.delivery_windows[0]
    : fulfillment?.delivery_windows;
  if (!customer?.email) return;
  const itemRows = Array.isArray(addon.items)
    ? (addon.items as Array<{
        name?: string;
        quantity?: number;
      }>)
    : [];
  try {
    await sendBreadClubAddonReceipt({
      to: String(customer.email),
      customerName: String(customer.name || "there"),
      membershipId: String(addon.membership_id),
      deliveryLabel: String(window?.label || "your Sunday delivery"),
      orderSummary: itemRows
        .map((item) => `${Number(item.quantity || 0)} x ${item.name || "Add-on"}`)
        .join("\n"),
      totalCents: Number(addon.subtotal_cents),
    });
  } catch (emailError) {
    console.error("[bread-club] add-on receipt failed", emailError);
  }
}

export async function expireBreadClubAddonCheckout(sessionId: string) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { data, error } = await supabase
    .from("bread_club_addon_checkouts")
    .select("id")
    .eq("stripe_checkout_session_id", sessionId)
    .eq("status", "pending_payment")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return;
  const { error: releaseError } = await supabase.rpc(
    "release_bread_club_addon_inventory",
    { p_addon_checkout_id: data.id },
  );
  if (releaseError) throw new Error(releaseError.message);
}
