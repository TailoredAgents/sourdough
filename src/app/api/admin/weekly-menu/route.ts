import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase";
import {
  getActiveWeeklyMenuData,
  getWeeklyMenuData,
  getWeeklyMenusData,
} from "@/lib/storefront-data";
import {
  weeklyMenuAdminSchema,
  weeklyMenuItemAvailabilityAdminSchema,
} from "@/lib/weekly-menu-admin";

function revalidateStorefrontMenuRoutes() {
  revalidatePath("/");
  revalidatePath("/sourdough-delivery-canton-ga");
  revalidatePath("/sourdough-delivery-woodstock-ga");
  revalidatePath("/menu/[slug]", "page");
  revalidatePath("/sourdough-delivery/[zip]", "page");
  revalidatePath("/sitemap.xml");
}

async function getWeeklyMenuAdminPayload(selectedId?: string | null) {
  const [weeklyMenus, activeWeeklyMenu] = await Promise.all([
    getWeeklyMenusData(),
    getActiveWeeklyMenuData(),
  ]);
  const fallbackId = activeWeeklyMenu?.id ?? weeklyMenus[0]?.id ?? null;
  const selectedWeeklyMenu = selectedId
    ? await getWeeklyMenuData(selectedId)
    : fallbackId
      ? await getWeeklyMenuData(fallbackId)
      : null;

  return {
    weeklyMenus,
    selectedWeeklyMenu,
    activeWeeklyMenu,
  };
}

export async function GET(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin authorization is required." },
      { status: 401 },
    );
  }

  const selectedId = new URL(request.url).searchParams.get("id");
  return NextResponse.json(await getWeeklyMenuAdminPayload(selectedId));
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
  let weeklyMenuId = weeklyMenu.id;

  if (weeklyMenuId) {
    const { error: menuError } = await supabase
      .from("weekly_menus")
      .update({
        name: weeklyMenu.name,
        order_cutoff_at: weeklyMenu.orderCutoffAt,
        starts_at: weeklyMenu.startsAt,
        ends_at: weeklyMenu.endsAt,
        published: weeklyMenu.published,
      })
      .eq("id", weeklyMenuId);

    if (menuError) {
      return NextResponse.json({ error: menuError.message }, { status: 400 });
    }
  } else {
    const { data, error: menuError } = await supabase
      .from("weekly_menus")
      .insert({
        name: weeklyMenu.name,
        order_cutoff_at: weeklyMenu.orderCutoffAt,
        starts_at: weeklyMenu.startsAt,
        ends_at: weeklyMenu.endsAt,
        published: weeklyMenu.published,
      })
      .select("id")
      .single();

    if (menuError) {
      return NextResponse.json({ error: menuError.message }, { status: 400 });
    }

    weeklyMenuId = data.id as string;
  }

  const includedItems = weeklyMenu.items.filter((item) => item.included);
  const excludedProductIds = weeklyMenu.items
    .filter((item) => !item.included)
    .map((item) => item.productId);

  if (includedItems.length) {
    const { error } = await supabase.from("weekly_menu_items").upsert(
      includedItems.map((item) => ({
        weekly_menu_id: weeklyMenuId,
        product_id: item.productId,
        available_quantity: item.availableQuantity,
        sold_quantity: item.soldQuantity,
        featured: item.unavailable ? false : item.featured,
        unavailable: item.unavailable,
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
      .eq("weekly_menu_id", weeklyMenuId)
      .in("product_id", excludedProductIds);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  revalidateStorefrontMenuRoutes();

  return NextResponse.json(await getWeeklyMenuAdminPayload(weeklyMenuId));
}

export async function PATCH(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin authorization is required." },
      { status: 401 },
    );
  }

  const parsed = weeklyMenuItemAvailabilityAdminSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid weekly menu item." },
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

  const { weeklyMenuId, productId, unavailable } = parsed.data;
  const { data, error } = await supabase
    .from("weekly_menu_items")
    .update({
      unavailable,
      ...(unavailable ? { featured: false } : {}),
    })
    .eq("weekly_menu_id", weeklyMenuId)
    .eq("product_id", productId)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (!data) {
    return NextResponse.json(
      { error: "This product is not included in the selected weekly menu." },
      { status: 404 },
    );
  }

  revalidateStorefrontMenuRoutes();

  return NextResponse.json(await getWeeklyMenuAdminPayload(weeklyMenuId));
}
