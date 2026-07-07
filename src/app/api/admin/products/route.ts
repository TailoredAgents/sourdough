import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { productAdminSchema, slugifyProductName } from "@/lib/product-admin";
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
  const row = {
    name: product.name,
    slug: slugifyProductName(product.name),
    category: product.category,
    description: product.description,
    ingredients: product.ingredients,
    allergens: product.allergens,
    price_cents: product.priceCents,
    image_style: product.imageStyle,
    active: product.active,
    updated_at: new Date().toISOString(),
  };

  const query = product.id
    ? supabase.from("products").update(row).eq("id", product.id)
    : supabase.from("products").insert(row);

  const { error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ products: await getProductsData() });
}
