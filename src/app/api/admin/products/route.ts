import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { rejectCrossOriginMutation } from "@/lib/request-security";
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
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;

  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin authorization is required." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = productAdminSchema.safeParse(body);
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
  let weeklyMenuIds: string[] = [];
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

    weeklyMenuIds = Array.from(
      new Set([
        ...rollingMenuIds,
        ...((activeMenus as Array<{ id: string }> | null) || []).map((menu) => menu.id),
      ]),
    );
  }

  const { data: productId, error } = await supabase.rpc("admin_save_product", {
    p_product_id: product.id || null,
    p_name: product.name,
    p_slug: slugifyProductName(product.name),
    p_category: product.category,
    p_description: product.description,
    p_ingredients: product.ingredients,
    p_allergens: product.allergens,
    p_price_cents: product.priceCents,
    p_estimated_ingredient_cost_cents:
      product.estimatedIngredientCostCents ?? null,
    p_image_url: product.imageUrl || null,
    p_image_style: product.imageStyle,
    p_active: product.active,
    p_include_in_menus: product.includeInCurrentMenu,
    p_weekly_menu_ids: weeklyMenuIds,
    p_weekly_quantity: product.weeklyQuantity,
    p_featured: product.featured,
    p_actor_email: admin.email,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (typeof productId !== "string") {
    return NextResponse.json(
      { error: "Product was saved but its identifier was not returned." },
      { status: 500 },
    );
  }

  revalidatePath("/");
  revalidatePath("/menu/[slug]", "page");
  revalidatePath("/sourdough-delivery-canton-ga");
  revalidatePath("/sourdough-delivery-woodstock-ga");
  revalidatePath("/sitemap.xml");

  return NextResponse.json({ products: await getProductsData(), productId });
}
