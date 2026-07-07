import {
  aiKnowledge as fallbackAiKnowledge,
  deliveryWindows as fallbackDeliveryWindows,
  getActiveMenu as getFallbackActiveMenu,
  getMenuProduct as getFallbackMenuProduct,
  products as fallbackProducts,
} from "./bakery-data";
import { getSupabaseAdminClient } from "./supabase";
import { getDeliverySettings, type DeliverySettings } from "./delivery";
import type { DeliveryWindow, MenuProduct, Product, WeeklyMenu } from "./types";

type ProductRow = {
  id: string;
  name: string;
  category: Product["category"];
  description: string;
  ingredients: string[];
  allergens: string[];
  price_cents: number;
  image_style: string;
  active: boolean;
};

type WeeklyMenuItemRow = {
  product_id: string;
  available_quantity: number;
  sold_quantity: number;
  featured: boolean;
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
};

function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    ingredients: row.ingredients,
    allergens: row.allergens,
    priceCents: row.price_cents,
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

async function getPublishedMenuId() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("weekly_menus")
    .select("id")
    .eq("published", true)
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[supabase] weekly menu lookup failed", error.message);
    return null;
  }

  return data?.id ?? null;
}

async function getPublishedMenuRow() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("weekly_menus")
    .select("id, name, order_cutoff_at, starts_at, ends_at, published")
    .eq("published", true)
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[supabase] weekly menu lookup failed", error.message);
    return null;
  }

  return (data as WeeklyMenuRow | null) ?? null;
}

export async function getActiveMenuData(): Promise<MenuProduct[]> {
  const supabase = getSupabaseAdminClient();
  const weeklyMenuId = await getPublishedMenuId();
  if (!supabase || !weeklyMenuId) return getFallbackActiveMenu();

  const { data, error } = await supabase
    .from("weekly_menu_items")
    .select(
      "product_id, available_quantity, sold_quantity, featured, products(id, name, category, description, ingredients, allergens, price_cents, image_style, active)",
    )
    .eq("weekly_menu_id", weeklyMenuId);

  if (error) {
    console.error("[supabase] menu items lookup failed", error.message);
    return getFallbackActiveMenu();
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

  return menu.length ? menu : getFallbackActiveMenu();
}

export async function getActiveWeeklyMenuData(): Promise<WeeklyMenu | null> {
  const row = await getPublishedMenuRow();
  const items = await getActiveMenuData();
  if (!row) return null;

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
  return menu.find((item) => item.id === productId) ?? getFallbackMenuProduct(productId);
}

export async function getProductsData(): Promise<Product[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return fallbackProducts;

  const { data, error } = await supabase
    .from("products")
    .select("id, name, category, description, ingredients, allergens, price_cents, image_style, active")
    .order("name", { ascending: true });

  if (error) {
    console.error("[supabase] products lookup failed", error.message);
    return fallbackProducts;
  }

  const products = (data as ProductRow[]).map(mapProduct);
  return products.length ? products : fallbackProducts;
}

export async function getDeliveryWindowsData(): Promise<DeliveryWindow[]> {
  const supabase = getSupabaseAdminClient();
  const weeklyMenuId = await getPublishedMenuId();
  if (!supabase || !weeklyMenuId) return fallbackDeliveryWindows;

  const { data, error } = await supabase
    .from("delivery_windows")
    .select("id, label, starts_at, ends_at, capacity, reserved")
    .eq("weekly_menu_id", weeklyMenuId)
    .order("starts_at", { ascending: true });

  if (error) {
    console.error("[supabase] delivery windows lookup failed", error.message);
    return fallbackDeliveryWindows;
  }

  const windows = (data as DeliveryWindowRow[]).map(mapDeliveryWindow);
  return windows.length ? windows : fallbackDeliveryWindows;
}

export async function getDeliveryWindowData(deliveryWindowId: string) {
  const windows = await getDeliveryWindowsData();
  return (
    windows.find((deliveryWindow) => deliveryWindow.id === deliveryWindowId) ??
    fallbackDeliveryWindows.find((deliveryWindow) => deliveryWindow.id === deliveryWindowId)
  );
}

export async function getDeliverySettingsData(): Promise<DeliverySettings> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return getDeliverySettings();

  const { data, error } = await supabase
    .from("delivery_settings")
    .select("center_lat, center_lng, radius_miles, delivery_fee_cents")
    .eq("id", true)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("[supabase] delivery settings lookup failed", error.message);
    return getDeliverySettings();
  }

  const row = data as DeliverySettingsRow;
  return {
    radiusMiles: Number(row.radius_miles),
    deliveryFeeCents: row.delivery_fee_cents,
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
