import { getOrderingWeeksData, getProductsData } from "@/lib/storefront-data";
import { ensureRollingWeeklyMenus } from "@/lib/rolling-weeks";
import { getSupabaseAdminClient } from "@/lib/supabase";
import type { Product } from "@/lib/types";
import { isBreadClubPublicEnabled } from "./config";
import { getBreadClubEnrollmentWeeks } from "./schedule";
import type {
  BreadClubDeliveryPrice,
  BreadClubEnrollmentData,
  BreadClubPlan,
  BreadClubPlanProduct,
  BreadClubPlanSlug,
  BreadClubSettings,
} from "./types";

type PlanRow = {
  id: string;
  slug: BreadClubPlanSlug;
  name: string;
  description: string;
  price_cents: number;
  loaves_per_week: number;
  active: boolean;
  sort_order: number;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  stripe_price_cents: number | null;
  stripe_lookup_key: string;
};

type EligibilityRow = {
  plan_id: string;
  product_id: string;
  guaranteed: boolean;
  active: boolean;
};

type DeliveryPriceRow = {
  id: string;
  band_key: string;
  label: string;
  min_minutes: number;
  max_minutes: number;
  price_cents: number;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  stripe_price_cents: number | null;
  stripe_lookup_key: string;
};

type SettingsRow = {
  max_weekly_loaf_slots: number;
  skip_limit_per_cycle: number;
  rollover_credit_days: number;
  tax_status: BreadClubSettings["taxStatus"];
  consent_version: string;
};

const FALLBACK_PLANS: Array<
  Omit<
    BreadClubPlan,
    | "eligibleProducts"
    | "stripeProductId"
    | "stripePriceId"
    | "stripePriceCents"
  >
> = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    slug: "classic",
    name: "Classic Club",
    description: "One dependable sourdough loaf every Sunday for four weeks.",
    priceCents: 4400,
    loavesPerWeek: 1,
    active: true,
    sortOrder: 10,
    stripeLookupKey: "bread_club_classic_4week_v1",
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    slug: "variety",
    name: "Variety Club",
    description: "Choose one available bread each Sunday for four weeks.",
    priceCents: 5200,
    loavesPerWeek: 1,
    active: true,
    sortOrder: 20,
    stripeLookupKey: "bread_club_variety_4week_v1",
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    slug: "family",
    name: "Family Club",
    description: "Choose any two available breads each Sunday for four weeks.",
    priceCents: 9600,
    loavesPerWeek: 2,
    active: true,
    sortOrder: 30,
    stripeLookupKey: "bread_club_family_4week_v1",
  },
];

const FALLBACK_DELIVERY_PRICES: BreadClubDeliveryPrice[] = [
  {
    id: "11000000-0000-4000-8000-000000000001",
    bandKey: "0-10",
    label: "Local delivery, 0-10 minutes",
    minMinutes: 0,
    maxMinutes: 10,
    priceCents: 2000,
    stripeProductId: null,
    stripePriceId: null,
    stripePriceCents: null,
    stripeLookupKey: "bread_club_delivery_0_10_4week_v1",
  },
  {
    id: "11000000-0000-4000-8000-000000000002",
    bandKey: "11-20",
    label: "Local delivery, 11-20 minutes",
    minMinutes: 11,
    maxMinutes: 20,
    priceCents: 2800,
    stripeProductId: null,
    stripePriceId: null,
    stripePriceCents: null,
    stripeLookupKey: "bread_club_delivery_11_20_4week_v1",
  },
  {
    id: "11000000-0000-4000-8000-000000000003",
    bandKey: "21-30",
    label: "Local delivery, 21-30 minutes",
    minMinutes: 21,
    maxMinutes: 30,
    priceCents: 4000,
    stripeProductId: null,
    stripePriceId: null,
    stripePriceCents: null,
    stripeLookupKey: "bread_club_delivery_21_30_4week_v1",
  },
];

function productForPlan(
  product: Product,
  slug: BreadClubPlanSlug,
  guaranteed = false,
): BreadClubPlanProduct | null {
  if (product.category !== "bread" || !product.active) return null;
  if (
    slug === "classic" &&
    !["classic country loaf", "sourdough loaf"].includes(
      product.name.toLowerCase(),
    )
  ) {
    return null;
  }

  return {
    id: product.id,
    name: product.name,
    description: product.description,
    imageUrl: product.imageUrl,
    imageStyle: product.imageStyle,
    ingredients: product.ingredients,
    allergens: product.allergens,
    priceCents: product.priceCents,
    guaranteed,
    estimatedIngredientCostCents:
      product.estimatedIngredientCostCents ?? null,
  };
}

function fallbackPlans(products: Product[]): BreadClubPlan[] {
  return FALLBACK_PLANS.map((plan) => ({
    ...plan,
    stripeProductId: null,
    stripePriceId: null,
    stripePriceCents: null,
    eligibleProducts: products
      .map((product) =>
        productForPlan(
          product,
          plan.slug,
          product.name.toLowerCase() === "classic country loaf",
        ),
      )
      .filter((product): product is BreadClubPlanProduct => Boolean(product)),
  }));
}

function mapPlans(
  planRows: PlanRow[],
  eligibilityRows: EligibilityRow[],
  products: Product[],
) {
  const productsById = new Map(products.map((product) => [product.id, product]));

  return planRows.map<BreadClubPlan>((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    priceCents: row.price_cents,
    loavesPerWeek: row.loaves_per_week,
    active: row.active,
    sortOrder: row.sort_order,
    stripeProductId: row.stripe_product_id,
    stripePriceId: row.stripe_price_id,
    stripePriceCents: row.stripe_price_cents,
    stripeLookupKey: row.stripe_lookup_key,
    eligibleProducts: eligibilityRows
      .filter((item) => item.plan_id === row.id && item.active)
      .map((item) => {
        const product = productsById.get(item.product_id);
        if (!product) return null;
        return productForPlan(product, row.slug, item.guaranteed);
      })
      .filter((product): product is BreadClubPlanProduct => Boolean(product)),
  }));
}

function mapDeliveryPrices(rows: DeliveryPriceRow[]) {
  return rows.map<BreadClubDeliveryPrice>((row) => ({
    id: row.id,
    bandKey: row.band_key,
    label: row.label,
    minMinutes: row.min_minutes,
    maxMinutes: row.max_minutes,
    priceCents: row.price_cents,
    stripeProductId: row.stripe_product_id,
    stripePriceId: row.stripe_price_id,
    stripePriceCents: row.stripe_price_cents,
    stripeLookupKey: row.stripe_lookup_key,
  }));
}

export async function getBreadClubCatalogData() {
  const supabase = getSupabaseAdminClient();
  const products = await getProductsData();

  if (!supabase) {
    return {
      plans: fallbackPlans(products),
      deliveryPrices: FALLBACK_DELIVERY_PRICES,
      settings: {
        maxWeeklyLoafSlots: 10,
        skipLimitPerCycle: 1,
        rolloverCreditDays: 60,
        taxStatus: "pending",
        consentVersion: "2026-07-26",
      } satisfies BreadClubSettings,
    };
  }

  const [planResult, eligibilityResult, deliveryResult, settingsResult] =
    await Promise.all([
      supabase
        .from("bread_club_plans")
        .select(
          "id, slug, name, description, price_cents, loaves_per_week, active, sort_order, stripe_product_id, stripe_price_id, stripe_price_cents, stripe_lookup_key",
        )
        .eq("active", true)
        .order("sort_order", { ascending: true }),
      supabase
        .from("bread_club_plan_products")
        .select("plan_id, product_id, guaranteed, active")
        .eq("active", true),
      supabase
        .from("bread_club_delivery_prices")
        .select(
          "id, band_key, label, min_minutes, max_minutes, price_cents, stripe_product_id, stripe_price_id, stripe_price_cents, stripe_lookup_key",
        )
        .eq("active", true)
        .order("min_minutes", { ascending: true }),
      supabase
        .from("bread_club_settings")
        .select(
          "max_weekly_loaf_slots, skip_limit_per_cycle, rollover_credit_days, tax_status, consent_version",
        )
        .eq("id", true)
        .maybeSingle(),
    ]);

  if (
    planResult.error ||
    eligibilityResult.error ||
    deliveryResult.error ||
    settingsResult.error
  ) {
    const message = [
      planResult.error?.message,
      eligibilityResult.error?.message,
      deliveryResult.error?.message,
      settingsResult.error?.message,
    ]
      .filter(Boolean)
      .join("; ");
    console.warn("[bread-club] catalog fallback", message);
    return {
      plans: fallbackPlans(products),
      deliveryPrices: FALLBACK_DELIVERY_PRICES,
      settings: {
        maxWeeklyLoafSlots: 10,
        skipLimitPerCycle: 1,
        rolloverCreditDays: 60,
        taxStatus: "pending",
        consentVersion: "2026-07-26",
      } satisfies BreadClubSettings,
    };
  }

  const settingsRow = settingsResult.data as SettingsRow | null;
  return {
    plans: mapPlans(
      (planResult.data || []) as PlanRow[],
      (eligibilityResult.data || []) as EligibilityRow[],
      products,
    ),
    deliveryPrices: mapDeliveryPrices(
      (deliveryResult.data || []) as DeliveryPriceRow[],
    ),
    settings: {
      maxWeeklyLoafSlots: settingsRow?.max_weekly_loaf_slots ?? 10,
      skipLimitPerCycle: settingsRow?.skip_limit_per_cycle ?? 1,
      rolloverCreditDays: settingsRow?.rollover_credit_days ?? 60,
      taxStatus: settingsRow?.tax_status ?? "pending",
      consentVersion: settingsRow?.consent_version ?? "2026-07-26",
    } satisfies BreadClubSettings,
  };
}

export async function getBreadClubEnrollmentData(
  now = new Date(),
): Promise<BreadClubEnrollmentData> {
  await ensureRollingWeeklyMenus(now);
  const [catalog, orderingWeeks] = await Promise.all([
    getBreadClubCatalogData(),
    getOrderingWeeksData(),
  ]);

  return {
    ...catalog,
    weeks: getBreadClubEnrollmentWeeks(orderingWeeks, now),
    publicEnabled: isBreadClubPublicEnabled(),
  };
}
