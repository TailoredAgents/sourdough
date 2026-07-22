import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { productAdminSchema, slugifyProductName } from "@/lib/product-admin";
import { ensureRollingWeeklyMenus } from "@/lib/rolling-weeks";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { getProductsData } from "@/lib/storefront-data";

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin authorization is required." },
      { status: 401 },
    );
  }

  return NextResponse.json({ products: await getProductsData() });
}

export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin authorization is required." },
      { status: 401 },
    );
  }

  const parsed = productAdminSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid product." },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase admin client is not configured." },
      { status: 500 },
    );
  }

  const product = parsed.data;
  const { data: existingProduct } = product.id
    ? await supabase
        .from("products")
        .select("price_cents, stripe_price_id, stripe_price_cents")
        .eq("id", product.id)
        .maybeSingle()
    : { data: null };
  const existingPriceCents =
    typeof existingProduct?.price_cents === "number"
      ? existingProduct.price_cents
      : null;
  const priceChanged =
    existingPriceCents !== null && existingPriceCents !== product.priceCents;
  const row = {
    name: product.name,
    slug: slugifyProductName(product.name),
    category: product.category,
    description: product.description,
    ingredients: product.ingredients,
    allergens: product.allergens,
    price_cents: product.priceCents,
    image_url: product.imageUrl || null,
    image_style: product.imageStyle,
    active: product.active,
    ...(priceChanged
      ? {
          stripe_price_id: null,
          stripe_price_cents: null,
          stripe_synced_at: null,
        }
      : {}),
    updated_at: new Date().toISOString(),
  };

  const query = product.id
    ? supabase.from("products").update(row).eq("id", product.id).select("id").single()
    : supabase.from("products").insert(row).select("id").single();

  const { data: savedProduct, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const productId = savedProduct.id as string;
  if (product.includeInCurrentMenu) {
    const rollingMenuIds = await ensureRollingWeeklyMenus();
    const { data: activeMenus, error: menusError } = await supabase
      .from("weekly_menus")
      .select("id")
      .eq("published", true)
      .gte("ends_at", new Date().toISOString())
      .order("starts_at", { ascending: true });

    if (menusError) {
      return NextResponse.json({ error: menusError.message }, { status: 400 });
    }

    const weeklyMenuIds = Array.from(
      new Set([
        ...rollingMenuIds,
        ...((activeMenus as Array<{ id: string }> | null) || []).map((menu) => menu.id),
      ]),
    );

    if (weeklyMenuIds.length) {
      const { data: existingItems, error: existingItemsError } = await supabase
        .from("weekly_menu_items")
        .select("weekly_menu_id")
        .eq("product_id", productId)
        .in("weekly_menu_id", weeklyMenuIds);

      if (existingItemsError) {
        return NextResponse.json({ error: existingItemsError.message }, { status: 400 });
      }

      const existingWeeklyMenuIds = new Set(
        ((existingItems as Array<{ weekly_menu_id: string }> | null) || []).map(
          (item) => item.weekly_menu_id,
        ),
      );
      const missingWeeklyMenuIds = weeklyMenuIds.filter(
        (weeklyMenuId) => !existingWeeklyMenuIds.has(weeklyMenuId),
      );

      const { error: menuError } = missingWeeklyMenuIds.length
        ? await supabase.from("weekly_menu_items").insert(
            missingWeeklyMenuIds.map((weeklyMenuId) => ({
              weekly_menu_id: weeklyMenuId,
              product_id: productId,
              available_quantity: product.weeklyQuantity,
              sold_quantity: 0,
              featured: product.featured,
              unavailable: false,
            })),
          )
        : { error: null };

      if (menuError) {
        return NextResponse.json({ error: menuError.message }, { status: 400 });
      }
    }
  }

  return NextResponse.json({ products: await getProductsData(), productId });
}
