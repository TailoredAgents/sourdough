import type {
  BreadClubDeliveryPrice,
  BreadClubPlan,
  BreadClubSelection,
} from "./types";
import { formatCurrency } from "@/lib/utils";

export function buildBreadClubConsentText(
  totalCents: number,
  automaticTaxEnabled: boolean,
  chargeDate = new Date(),
) {
  const firstChargeLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(chargeDate);
  return `I authorize ${formatCurrency(totalCents)} to be charged today, ${firstChargeLabel}, and every four weeks until I cancel through my membership page or by emailing orders@landlsourdough.com. ${
    automaticTaxEnabled
      ? "Applicable tax will be calculated and shown in Stripe before payment."
      : "No additional tax is currently added; any future tax change will be disclosed before it applies."
  }`;
}

export function canReserveBreadClubLoafSlots(
  committedLoaves: number,
  requestedLoaves: number,
  maximumLoaves = 10,
) {
  return (
    Number.isInteger(committedLoaves) &&
    Number.isInteger(requestedLoaves) &&
    Number.isInteger(maximumLoaves) &&
    committedLoaves >= 0 &&
    requestedLoaves > 0 &&
    maximumLoaves > 0 &&
    committedLoaves + requestedLoaves <= maximumLoaves
  );
}

export function getCycleDeliveryPriceCents(weeklyFeeCents: number) {
  return weeklyFeeCents * 4;
}

export function getBreadClubDeliveryBandKey(
  durationMinutes: number | undefined,
  weeklyFeeCents: number,
) {
  if (typeof durationMinutes === "number") {
    if (durationMinutes <= 10) return "0-10";
    if (durationMinutes <= 20) return "11-20";
    if (durationMinutes <= 30) return "21-30";
  }

  if (weeklyFeeCents <= 500) return "0-10";
  if (weeklyFeeCents <= 700) return "11-20";
  return "21-30";
}

export function findBreadClubDeliveryPrice(
  prices: BreadClubDeliveryPrice[],
  durationMinutes: number | undefined,
  weeklyFeeCents: number,
) {
  const bandKey = getBreadClubDeliveryBandKey(
    durationMinutes,
    weeklyFeeCents,
  );
  return prices.find((price) => price.bandKey === bandKey) ?? null;
}

export function getBreadClubCycleTotalCents(
  planPriceCents: number,
  deliveryPriceCents: number,
  taxCents = 0,
) {
  return planPriceCents + deliveryPriceCents + taxCents;
}

export function getBreadClubRenewalPricing(input: {
  currentPlanPriceCents: number;
  currentDeliveryPriceCents: number;
  previousPlanPriceCents?: number | null;
  previousDeliveryPriceCents?: number | null;
  applyCurrentPlanPrice: boolean;
  applyCurrentDeliveryPrice: boolean;
}) {
  const previousPlanPriceIsValid =
    Number.isInteger(input.previousPlanPriceCents) &&
    Number(input.previousPlanPriceCents) >= 0;
  const previousDeliveryPriceIsValid =
    Number.isInteger(input.previousDeliveryPriceCents) &&
    Number(input.previousDeliveryPriceCents) >= 0;
  const planPriceCents =
    input.applyCurrentPlanPrice || !previousPlanPriceIsValid
      ? input.currentPlanPriceCents
      : Number(input.previousPlanPriceCents);
  const deliveryPriceCents =
    input.applyCurrentDeliveryPrice || !previousDeliveryPriceIsValid
      ? input.currentDeliveryPriceCents
      : Number(input.previousDeliveryPriceCents);

  return {
    planPriceCents,
    deliveryPriceCents,
    totalCents: getBreadClubCycleTotalCents(
      planPriceCents,
      deliveryPriceCents,
    ),
  };
}

export function getBreadClubDeliveredTotals(
  planPriceCents: number,
  deliveryPrices = [2000, 2800, 4000],
) {
  return deliveryPrices.map((deliveryPriceCents) =>
    getBreadClubCycleTotalCents(planPriceCents, deliveryPriceCents),
  );
}

export function normalizeBreadClubSelection(
  selection: BreadClubSelection[],
) {
  const quantities = new Map<string, number>();
  for (const item of selection) {
    if (!item.productId || !Number.isInteger(item.quantity) || item.quantity <= 0) {
      continue;
    }
    quantities.set(
      item.productId,
      (quantities.get(item.productId) || 0) + item.quantity,
    );
  }

  return Array.from(quantities, ([productId, quantity]) => ({
    productId,
    quantity,
  }));
}

export function getSelectionQuantity(selection: BreadClubSelection[]) {
  return normalizeBreadClubSelection(selection).reduce(
    (sum, item) => sum + item.quantity,
    0,
  );
}

export function validateBreadClubSelection(
  plan: BreadClubPlan,
  selection: BreadClubSelection[],
) {
  const normalized = normalizeBreadClubSelection(selection);
  if (getSelectionQuantity(normalized) !== plan.loavesPerWeek) {
    return `${plan.name} requires ${plan.loavesPerWeek} ${
      plan.loavesPerWeek === 1 ? "loaf" : "loaves"
    } each Sunday.`;
  }

  const eligibleIds = new Set(plan.eligibleProducts.map((product) => product.id));
  if (normalized.some((item) => !eligibleIds.has(item.productId))) {
    return "One selected loaf is not eligible for this plan.";
  }

  return null;
}

export function estimatePlanContributionCents(
  plan: BreadClubPlan,
  selection: BreadClubSelection[],
  stripeFeeRate = 0.036,
  stripeFixedFeeCents = 30,
) {
  const costByProduct = new Map(
    plan.eligibleProducts.map((product) => [
      product.id,
      product.estimatedIngredientCostCents,
    ]),
  );
  let ingredientCostCents = 0;
  let completeIngredientCost = true;

  for (const item of normalizeBreadClubSelection(selection)) {
    const cost = costByProduct.get(item.productId);
    if (typeof cost !== "number") {
      completeIngredientCost = false;
      continue;
    }
    ingredientCostCents += cost * item.quantity * 4;
  }

  const stripeFeeCents = Math.round(
    plan.priceCents * stripeFeeRate + stripeFixedFeeCents,
  );

  return {
    ingredientCostCents: completeIngredientCost ? ingredientCostCents : null,
    stripeFeeCents,
    contributionCents: completeIngredientCost
      ? plan.priceCents - ingredientCostCents - stripeFeeCents
      : null,
  };
}
