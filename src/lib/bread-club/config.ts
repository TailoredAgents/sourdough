import type { BreadClubPlanSlug } from "./types";

export const BREAD_CLUB_CYCLE_WEEKS = 4;
export const BREAD_CLUB_DEFAULT_MAX_LOAF_SLOTS = 10;
export const BREAD_CLUB_SESSION_COOKIE = "bread_club_session";
export const BREAD_CLUB_MAGIC_LINK_MINUTES = 20;
export const BREAD_CLUB_SESSION_DAYS = 30;

export const BREAD_CLUB_PLAN_COPY: Record<
  BreadClubPlanSlug,
  {
    badge?: string;
    shortDescription: string;
    included: string[];
    fromDeliveredCents: number;
  }
> = {
  classic: {
    shortDescription: "A dependable loaf on the doorstep every Sunday.",
    included: [
      "One loaf each Sunday",
      "Classic Country guaranteed",
      "Four Sunday deliveries",
    ],
    fromDeliveredCents: 6400,
  },
  variety: {
    badge: "Most flexible",
    shortDescription: "Choose a different available bread each week.",
    included: [
      "One bread of your choice each Sunday",
      "Four Sunday deliveries",
      "Weekly selection changes before cutoff",
    ],
    fromDeliveredCents: 7200,
  },
  family: {
    shortDescription: "Two loaves each Sunday for a busier household.",
    included: [
      "Any two available breads each Sunday",
      "Eight loaves across four weeks",
      "Weekly selection changes before cutoff",
    ],
    fromDeliveredCents: 11600,
  },
};

function envBoolean(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}
function normalizedEmailSet(value: string | undefined) {
  return new Set(
    (value || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isBreadClubPublicEnabled() {
  return envBoolean(process.env.BREAD_CLUB_PUBLIC_ENABLED);
}

export function isBreadClubAutomaticTaxEnabled() {
  return envBoolean(process.env.BREAD_CLUB_AUTOMATIC_TAX_ENABLED);
}

export function isBreadClubTestCustomer(email: string) {
  if (process.env.NODE_ENV !== "production") return true;
  return normalizedEmailSet(process.env.BREAD_CLUB_TEST_EMAILS).has(
    email.trim().toLowerCase(),
  );
}

export function getBreadClubTaxStatus() {
  const status = process.env.BREAD_CLUB_TAX_STATUS?.trim().toLowerCase();
  return status === "registered" || status === "exempt" ? status : "pending";
}

export function getBreadClubCheckoutGate(email: string) {
  const testCustomer = isBreadClubTestCustomer(email);
  const publicEnabled = isBreadClubPublicEnabled();
  const taxStatus = getBreadClubTaxStatus();

  if (!publicEnabled && !testCustomer) {
    return {
      allowed: false,
      reason: "Bread Club enrollment is not open yet.",
    };
  }

  if (taxStatus === "pending" && !testCustomer) {
    return {
      allowed: false,
      reason:
        "Bread Club enrollment is paused while the bakery confirms applicable tax treatment.",
    };
  }

  return { allowed: true, reason: null };
}

export function getBreadClubPortalConfigurationId() {
  return process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID?.trim() || null;
}
