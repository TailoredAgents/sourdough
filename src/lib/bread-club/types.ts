import type {
  DeliveryAddress,
  DeliveryWindow,
  MenuProduct,
  WeeklyMenu,
} from "@/lib/types";

export type BreadClubPlanSlug = "classic" | "variety" | "family";

export type BreadClubPlanProduct = Pick<
  MenuProduct,
  | "id"
  | "name"
  | "description"
  | "imageUrl"
  | "imageStyle"
  | "ingredients"
  | "allergens"
  | "priceCents"
> & {
  guaranteed: boolean;
  estimatedIngredientCostCents: number | null;
};

export type BreadClubPlan = {
  id: string;
  slug: BreadClubPlanSlug;
  name: string;
  description: string;
  priceCents: number;
  loavesPerWeek: number;
  active: boolean;
  sortOrder: number;
  stripeProductId: string | null;
  stripePriceId: string | null;
  stripePriceCents: number | null;
  stripeLookupKey: string;
  eligibleProducts: BreadClubPlanProduct[];
};

export type BreadClubDeliveryPrice = {
  id: string;
  bandKey: string;
  label: string;
  minMinutes: number;
  maxMinutes: number;
  priceCents: number;
  stripeProductId: string | null;
  stripePriceId: string | null;
  stripePriceCents: number | null;
  stripeLookupKey: string;
};

export type BreadClubSelection = {
  productId: string;
  quantity: number;
};

export type BreadClubEnrollmentWeek = {
  weeklyMenu: WeeklyMenu;
  deliveryWindow: DeliveryWindow;
  menu: MenuProduct[];
  selection: BreadClubSelection[];
};

export type BreadClubSettings = {
  maxWeeklyLoafSlots: number;
  skipLimitPerCycle: number;
  rolloverCreditDays: number;
  taxStatus: "pending" | "registered" | "exempt";
  consentVersion: string;
};

export type BreadClubEnrollmentData = {
  plans: BreadClubPlan[];
  deliveryPrices: BreadClubDeliveryPrice[];
  weeks: BreadClubEnrollmentWeek[];
  settings: BreadClubSettings;
  publicEnabled: boolean;
};

export type BreadClubCheckoutRequest = {
  planId: string;
  selection: BreadClubSelection[];
  customer: {
    name: string;
    email: string;
    phone: string;
  };
  address: DeliveryAddress;
  deliveryInstructions?: string;
  acknowledgedAutoRenewal: true;
  consentText: string;
};

export type BreadClubMembershipStatus =
  | "pending_checkout"
  | "active"
  | "past_due"
  | "canceling"
  | "canceled"
  | "incomplete";

export type BreadClubFulfillmentStatus =
  | "pending_payment"
  | "scheduled"
  | "skipped"
  | "fulfilled"
  | "canceled";

export type BreadClubMemberFulfillment = {
  id: string;
  status: BreadClubFulfillmentStatus;
  weeklyMenuId: string;
  weeklyMenuName: string;
  cutoffAt: string;
  deliveryWindowId: string;
  deliveryLabel: string;
  deliveryStartsAt: string;
  selection: BreadClubSelection[];
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
  }>;
  availableProducts: Array<{
    id: string;
    name: string;
    remainingQuantity: number;
    unavailable: boolean;
  }>;
  availableAddons: Array<{
    id: string;
    name: string;
    remainingQuantity: number;
    priceCents: number;
    unavailable: boolean;
  }>;
};

export type BreadClubMemberCredit = {
  id: string;
  quantity: number;
  deliveryFeeCreditCents: number;
  status: "available" | "redeemed" | "expired" | "refunded";
  expiresAt: string;
};

export type BreadClubMemberData = {
  id: string;
  status: BreadClubMembershipStatus;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  plan: BreadClubPlan;
  routeFeeCents: number;
  routeBandKey: string;
  deliveryAddress: DeliveryAddress;
  deliveryInstructions: string | null;
  cancelAtPeriodEnd: boolean;
  firstDeliveryAt: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentCycle: {
    id: string;
    cycleNumber: number;
    status: string;
    periodStart: string;
    periodEnd: string;
    skipCount: number;
    totalCents: number;
  } | null;
  fulfillments: BreadClubMemberFulfillment[];
  credits: BreadClubMemberCredit[];
};
