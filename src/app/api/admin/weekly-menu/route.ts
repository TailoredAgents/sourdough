import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { getActiveWeeklyMenuData } from "@/lib/storefront-data";
import { weeklyMenuAdminSchema } from "@/lib/weekly-menu-admin";

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin authorization is required." },
      { status: 401 },
    );
  }

  return NextResponse.json({ weeklyMenu: await getActiveWeeklyMenuData() });
}

export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin authorization is required." },
      { status: 401 },
    );
  }

  const parsed = weeklyMenuAdminSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid weekly menu." },
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

  const weeklyMenu = parsed.data;
  const { error: menuError } = await supabase
    .from("weekly_menus")
    .update({
      name: weeklyMenu.name,
      order_cutoff_at: weeklyMenu.orderCutoffAt,
      starts_at: weeklyMenu.startsAt,
      ends_at: weeklyMenu.endsAt,
      published: weeklyMenu.published,
    })
    .eq("id", weeklyMenu.id);

  if (menuError) {
    return NextResponse.json({ error: menuError.message }, { status: 400 });
  }

  const includedItems = weeklyMenu.items.filter((item) => item.included);
  const excludedProductIds = weeklyMenu.items
    .filter((item) => !item.included)
    .map((item) => item.productId);

  if (includedItems.length) {
    const { error } = await supabase.from("weekly_menu_items").upsert(
      includedItems.map((item) => ({
        weekly_menu_id: weeklyMenu.id,
        product_id: item.productId,
        available_quantity: item.availableQuantity,
        sold_quantity: item.soldQuantity,
        featured: item.featured,
      })),
      { onConflict: "weekly_menu_id,product_id" },
    );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  if (excludedProductIds.length) {
    const { error } = await supabase
      .from("weekly_menu_items")
      .delete()
      .eq("weekly_menu_id", weeklyMenu.id)
      .in("product_id", excludedProductIds);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  return NextResponse.json({ weeklyMenu: await getActiveWeeklyMenuData() });
}
