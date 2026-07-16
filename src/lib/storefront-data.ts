import {
  aiKnowledge as fallbackAiKnowledge,
  getActiveMenu as getFallbackActiveMenu,
  getFallbackDeliveryWindows,
  getFallbackWeeklyMenu,
  getMenuProduct as getFallbackMenuProduct,
  products as fallbackProducts,
} from "./bakery-data";
import { productSlug } from "./product-slugs";
import { getSupabaseAdminClient } from "./supabase";
import {
  getDeliverySettings,
  normalizePostalCode,
  type DeliverySettings,
} from "./delivery";
import { isWeeklyMenuItemUnavailable } from "./menu-availability";
import type {
  DeliveryWindow,
  MenuProduct,
  Product,
  WeeklyMenu,
  WeeklyMenuSummary,
} from "./types";

type ProductRow = {
  id: string;
  name: string;
  category: Product["category"];
  description: string;
  ingredients: string[];
  allergens: string[];
  price_cents: number;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  stripe_price_cents: number | null;
  stripe_synced_at: string | null;
  image_url: string | null;
  image_style: string;
  active: boolean;
};

type WeeklyMenuItemRow = {
  product_id: string;
  available_quantity: number;
  sold_quantity: number;
  featured: boolean;
  unavailable: boolean | null;
  products: ProductRow | ProductRow[] | null;
};

type WeeklyMenuRow = {
  id: string;
  name: string;
  order_cutoff_at: string;
  starts_at: string;
  ends_at: string;
  published: boolean;
};

type WeeklyMenuItemCountRow = {
  weekly_menu_id: string;
};

type DeliveryWindowRow = {
  id: string;
  label: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  reserved: number;
};

type DeliverySettingsRow = {
  center_lat: number | string;
  center_lng: number | string;
  radius_miles: number | string;
  delivery_fee_cents: number;
  allowed_postal_codes: string[] | null;
  service_area_copy: string | null;
};

export function canUseLocalFallback(nodeEnv = process.env.NODE_ENV) {
  return nodeEnv !== "production";
}

function getUnavailableDeliverySettings(): DeliverySettings {
  return {
    ...getDeliverySettings(),
    deliveryFeeCents: 0,
    allowedPostalCodes: [],
    serviceAreaCopy:
      "Delivery is temporarily unavailable while the bakery updates its service area.",
  };
}

function mergeAllowedPostalCodes(configured: string[] | null | undefined) {
  const defaultPostalCodes = getDeliverySettings().allowedPostalCodes;
  const merged = [...(configured || []), ...defaultPostalCodes]
    .map((postalCode) => normalizePostalCode(postalCode))
    .filter((postalCode): postalCode is string => Boolean(postalCode));

  return Array.from(new Set(merged));
}

function getCurrentServiceAreaCopy(rowCopy: string | null | undefined) {
  const fallback = getDeliverySettings();
  const copy = rowCopy || fallback.serviceAreaCopy;
  const mentionsCurrentPostalCodes = fallback.allowedPostalCodes.every((postalCode) =>
    copy.includes(postalCode),
  );

  return mentionsCurrentPostalCodes ? copy : fallback.serviceAreaCopy;
}

function getFallbackProductImageUrl(name: string) {
  const slug = productSlug({ name });
  const knownImages = new Set([
    "classic-country-loaf",
    "rosemary-garlic-loaf",
    "cinnamon-swirl-sourdough",
    "sourdough-starter-crackers",
    "whipped-honey-butter",
  ]);

  return knownImages.has(slug) ? `/images/products/${slug}.webp` : null;
}

function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    ingredients: row.ingredients,
    allergens: row.allergens,
    priceCents: row.price_cents,
    stripeProductId: row.stripe_product_id,
    stripePriceId: row.stripe_price_id,
    stripePriceCents: row.stripe_price_cents,
    stripeSyncedAt: row.stripe_synced_at,
    imageUrl: row.image_url || getFallbackProductImageUrl(row.name),
    imageStyle: row.image_style,
    active: row.active,
  };
}

function mapMenuItem(row: WeeklyMenuItemRow): MenuProduct | null {
  const productRow = Array.isArray(row.products) ? row.products[0] : row.products;
  if (!productRow) return null;

  const product = mapProduct(productRow);
  return {
    ...product,
    productId: row.product_id,
    availableQuantity: row.available_quantity,
    soldQuantity: row.sold_quantity,
    featured: row.featured,
    unavailable:
      Boolean(row.unavailable) ||
      isWeeklyMenuItemUnavailable({
        availableQuantity: row.available_quantity,
        soldQuantity: row.sold_quantity,
      }),
    remainingQuantity: Math.max(row.available_quantity - row.sold_quantity, 0),
  };
}

function mapDeliveryWindow(row: DeliveryWindowRow): DeliveryWindow {
  return {
    id: row.id,
    label: row.label,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    capacity: row.capacity,
    reserved: row.reserved,
  };
}

export async function getPublishedMenuId() {
  const row = await getPublishedMenuRow();
  return row?.id ?? null;
}

function mapWeeklyMenuSummary(
  row: WeeklyMenuRow,
  itemCounts: Map<string, number>,
): WeeklyMenuSummary {
  return {
    id: row.id,
    name: row.name,
    orderCutoffAt: row.order_cutoff_at,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    published: row.published,
    itemCount: itemCounts.get(row.id) || 0,
  };
}

async function getPublishedMenuRow() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return null;

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("weekly_menus")
    .select("id, name, order_cutoff_at, starts_at, ends_at, published")
    .eq("published", true)
    .gte("ends_at", now)
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[supabase] weekly menu lookup failed", error.message);
    return null;
  }

  return (data as WeeklyMenuRow | null) ?? null;
}

async function getMenuItemsData(weeklyMenuId: string): Promise<MenuProduct[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return canUseLocalFallback() ? getFallbackActiveMenu() : [];

  const { data, error } = await supabase
    .from("weekly_menu_items")
    .select(
      "product_id, available_quantity, sold_quantity, featured, unavailable, products(id, name, category, description, ingredients, allergens, price_cents, stripe_product_id, stripe_price_id, stripe_price_cents, stripe_synced_at, image_url, image_style, active)",
    )
    .eq("weekly_menu_id", weeklyMenuId);

  if (error) {
    console.error("[supabase] menu items lookup failed", error.message);
    return canUseLocalFallback() ? getFallbackActiveMenu() : [];
  }

  const menu = (data as WeeklyMenuItemRow[])
    .map(mapMenuItem)
    .filter((item): item is MenuProduct => Boolean(item))
    .filter((item) => item.active)
    .sort((a, b) => {
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      if (a.category !== b.category) return a.category === "bread" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  return menu.length ? menu : canUseLocalFallback() ? getFallbackActiveMenu() : [];
}

export async function getWeeklyMenusData(): Promise<WeeklyMenuSummary[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return [];

  const recentSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("weekly_menus")
    .select("id, name, order_cutoff_at, starts_at, ends_at, published")
    .gte("ends_at", recentSince)
    .order("starts_at", { ascending: true });

  if (error) {
    console.error("[supabase] weekly menus lookup failed", error.message);
    return [];
  }

  const rows = (data as WeeklyMenuRow[]) || [];
  const ids = rows.map((row) => row.id);
  const itemCounts = new Map<string, number>();

  if (ids.length) {
    const { data: itemRows, error: itemError } = await supabase
      .from("weekly_menu_items")
      .select("weekly_menu_id")
      .in("weekly_menu_id", ids);

    if (itemError) {
      console.error("[supabase] weekly menu item count lookup failed", itemError.message);
    } else {
      for (const item of (itemRows as WeeklyMenuItemCountRow[]) || []) {
        itemCounts.set(item.weekly_menu_id, (itemCounts.get(item.weekly_menu_id) || 0) + 1);
      }
    }
  }

  return rows.map((row) => mapWeeklyMenuSummary(row, itemCounts));
}

export async function getWeeklyMenuData(weeklyMenuId: string): Promise<WeeklyMenu | null> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("weekly_menus")
    .select("id, name, order_cutoff_at, starts_at, ends_at, published")
    .eq("id", weeklyMenuId)
    .maybeSingle();

  if (error) {
    console.error("[supabase] selected weekly menu lookup failed", error.message);
    return null;
  }

  const row = data as WeeklyMenuRow | null;
  if (!row) return null;
  const items = await getMenuItemsData(row.id);

  return {
    id: row.id,
    name: row.name,
    orderCutoffAt: row.order_cutoff_at,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    published: row.published,
    items,
  };
}

export async function getActiveMenuData(): Promise<MenuProduct[]> {
  const supabase = getSupabaseAdminClient();
  const weeklyMenuId = await getPublishedMenuId();
  if (!supabase || !weeklyMenuId) {
    return canUseLocalFallback() ? getFallbackActiveMenu() : [];
  }

  return getMenuItemsData(weeklyMenuId);
}

export async function getActiveWeeklyMenuData(): Promise<WeeklyMenu | null> {
  const row = await getPublishedMenuRow();
  if (!row) return canUseLocalFallback() ? getFallbackWeeklyMenu() : null;
  const items = await getMenuItemsData(row.id);

  return {
    id: row.id,
    name: row.name,
    orderCutoffAt: row.order_cutoff_at,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    published: row.published,
    items,
  };
}

export async function getMenuProductData(productId: string) {
  const menu = await getActiveMenuData();
  return (
    menu.find((item) => item.id === productId) ??
    (canUseLocalFallback() ? getFallbackMenuProduct(productId) : null)
  );
}

export async function getProductsData(): Promise<Product[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return canUseLocalFallback() ? fallbackProducts : [];

  const { data, error } = await supabase
    .from("products")
    .select("id, name, category, description, ingredients, allergens, price_cents, stripe_product_id, stripe_price_id, stripe_price_cents, stripe_synced_at, image_url, image_style, active")
    .order("name", { ascending: true });

  if (error) {
    console.error("[supabase] products lookup failed", error.message);
    return canUseLocalFallback() ? fallbackProducts : [];
  }

  const products = (data as ProductRow[]).map(mapProduct);
  return products.length ? products : canUseLocalFallback() ? fallbackProducts : [];
}

export async function getDeliveryWindowsForMenuData(
  weeklyMenuId: string | null,
): Promise<DeliveryWindow[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase || !weeklyMenuId) {
    return canUseLocalFallback() ? getFallbackDeliveryWindows() : [];
  }

  const { data, error } = await supabase
    .from("delivery_windows")
    .select("id, label, starts_at, ends_at, capacity, reserved")
    .eq("weekly_menu_id", weeklyMenuId)
    .order("starts_at", { ascending: true });

  if (error) {
    console.error("[supabase] delivery windows lookup failed", error.message);
    return canUseLocalFallback() ? getFallbackDeliveryWindows() : [];
  }

  return (data as DeliveryWindowRow[]).map(mapDeliveryWindow);
}

export async function getDeliveryWindowsData(): Promise<DeliveryWindow[]> {
  return getDeliveryWindowsForMenuData(await getPublishedMenuId());
}

export async function getDeliveryWindowData(deliveryWindowId: string) {
  const windows = await getDeliveryWindowsData();
  return (
    windows.find((deliveryWindow) => deliveryWindow.id === deliveryWindowId) ??
    (canUseLocalFallback()
      ? getFallbackDeliveryWindows().find(
          (deliveryWindow) => deliveryWindow.id === deliveryWindowId,
        )
      : undefined)
  );
}

export async function getDeliverySettingsData(): Promise<DeliverySettings> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return canUseLocalFallback()
      ? getDeliverySettings()
      : getUnavailableDeliverySettings();
  }

  const { data, error } = await supabase
    .from("delivery_settings")
    .select("center_lat, center_lng, radius_miles, delivery_fee_cents, allowed_postal_codes, service_area_copy")
    .eq("id", true)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("[supabase] delivery settings lookup failed", error.message);
    return canUseLocalFallback()
      ? getDeliverySettings()
      : getUnavailableDeliverySettings();
  }

  const row = data as DeliverySettingsRow;
  return {
    radiusMiles: Number(row.radius_miles),
    deliveryFeeCents: row.delivery_fee_cents,
    allowedPostalCodes: mergeAllowedPostalCodes(row.allowed_postal_codes),
    serviceAreaCopy: getCurrentServiceAreaCopy(row.service_area_copy),
    center: {
      lat: Number(row.center_lat),
      lng: Number(row.center_lng),
    },
  };
}

export async function getApprovedAiKnowledgeData(): Promise<string[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return fallbackAiKnowledge;

  const { data, error } = await supabase
    .from("ai_knowledge_entries")
    .select("body")
    .eq("approved", true)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[supabase] AI knowledge lookup failed", error.message);
    return fallbackAiKnowledge;
  }

  const entries = data.map((entry) => entry.body).filter(Boolean);
  return entries.length ? entries : fallbackAiKnowledge;
}

export async function getStorefrontData() {
  const [menu, weeklyMenu, deliveryWindows, aiKnowledge, products, deliverySettings] = await Promise.all([
    getActiveMenuData(),
    getActiveWeeklyMenuData(),
    getDeliveryWindowsData(),
    getApprovedAiKnowledgeData(),
    getProductsData(),
    getDeliverySettingsData(),
  ]);

  return {
    menu,
    weeklyMenu,
    deliveryWindows,
    aiKnowledge,
    products,
    deliverySettings,
  };
}
