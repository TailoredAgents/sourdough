import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { rejectCrossOriginMutation } from "@/lib/request-security";
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
  const parsed = weeklyMenuAdminSchema.safeParse(body);
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
  const includedItems = weeklyMenu.items.filter((item) => item.included);
  const { data: weeklyMenuId, error } = await supabase.rpc(
    "admin_save_weekly_menu",
    {
      p_weekly_menu_id: weeklyMenu.id || null,
      p_name: weeklyMenu.name,
      p_order_cutoff_at: weeklyMenu.orderCutoffAt,
      p_starts_at: weeklyMenu.startsAt,
      p_ends_at: weeklyMenu.endsAt,
      p_published: weeklyMenu.published,
      p_items: includedItems.map((item) => ({
        product_id: item.productId,
        available_quantity: item.availableQuantity,
        featured: item.unavailable ? false : item.featured,
        unavailable: item.unavailable,
      })),
      p_actor_email: admin.email,
    },
  );

  if (error) {
    const conflict = /already sold|paid or reserved|cannot be removed|cannot be lower/i.test(
      error.message,
    );
    return NextResponse.json(
      { error: error.message },
      { status: conflict ? 409 : 400 },
    );
  }
  if (typeof weeklyMenuId !== "string") {
    return NextResponse.json(
      { error: "Weekly menu was saved but its identifier was not returned." },
      { status: 500 },
    );
  }

  revalidateStorefrontMenuRoutes();

  return NextResponse.json(await getWeeklyMenuAdminPayload(weeklyMenuId));
}

export async function PATCH(request: Request) {
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
  const parsed = weeklyMenuItemAvailabilityAdminSchema.safeParse(body);
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
    .rpc("admin_set_weekly_menu_item_availability", {
      p_weekly_menu_id: weeklyMenuId,
      p_product_id: productId,
      p_unavailable: unavailable,
      p_actor_email: admin.email,
    });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (data !== true) {
    return NextResponse.json(
      { error: "This product is not included in the selected weekly menu." },
      { status: 404 },
    );
  }

  revalidateStorefrontMenuRoutes();

  return NextResponse.json(await getWeeklyMenuAdminPayload(weeklyMenuId));
}
