import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { productAdminSchema, slugifyProductName } from "@/lib/product-admin";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { getProductsData, getPublishedMenuId } from "@/lib/storefront-data";

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
  if (!product.id && product.includeInCurrentMenu) {
    const weeklyMenuId = await getPublishedMenuId();
    if (weeklyMenuId) {
      const { error: menuError } = await supabase.from("weekly_menu_items").upsert(
        {
          weekly_menu_id: weeklyMenuId,
          product_id: productId,
          available_quantity: product.weeklyQuantity,
          sold_quantity: 0,
          featured: product.featured,
        },
        { onConflict: "weekly_menu_id,product_id" },
      );

      if (menuError) {
        return NextResponse.json({ error: menuError.message }, { status: 400 });
      }
    }
  }

  return NextResponse.json({ products: await getProductsData(), productId });
}
