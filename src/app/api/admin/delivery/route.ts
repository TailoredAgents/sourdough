import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { rejectCrossOriginMutation } from "@/lib/request-security";
import { deliveryAdminSchema } from "@/lib/delivery-admin";
import { getSupabaseAdminClient } from "@/lib/supabase";
import {
  getDeliveryWindowsForMenuData,
  getDeliverySettingsData,
  getPublishedMenuId,
} from "@/lib/storefront-data";

async function getDeliveryAdminData(weeklyMenuId?: string | null) {
  const selectedWeeklyMenuId = weeklyMenuId || (await getPublishedMenuId());
  const [deliverySettings, deliveryWindows] = await Promise.all([
    getDeliverySettingsData(),
    getDeliveryWindowsForMenuData(selectedWeeklyMenuId),
  ]);

  return { deliverySettings, deliveryWindows, weeklyMenuId: selectedWeeklyMenuId };
}

function revalidateDeliveryRoutes() {
  revalidatePath("/");
  revalidatePath("/sourdough-delivery-canton-ga");
  revalidatePath("/sourdough-delivery-woodstock-ga");
  revalidatePath("/sourdough-delivery/[zip]", "page");
}

export async function GET(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin authorization is required." },
      { status: 401 },
    );
  }

  const weeklyMenuId = new URL(request.url).searchParams.get("weeklyMenuId");
  return NextResponse.json(await getDeliveryAdminData(weeklyMenuId));
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
  const parsed = deliveryAdminSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid delivery settings." },
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

  const { settings, windows } = parsed.data;
  const weeklyMenuId = parsed.data.weeklyMenuId;
  if (!weeklyMenuId) {
    return NextResponse.json(
      { error: "Choose a weekly menu before editing Sunday delivery." },
      { status: 400 },
    );
  }

  const { error } = await supabase.rpc("admin_save_delivery_configuration", {
    p_weekly_menu_id: weeklyMenuId,
    p_settings: {
      center_lat: settings.centerLat,
      center_lng: settings.centerLng,
      radius_miles: settings.radiusMiles,
      delivery_fee_cents: settings.deliveryFeeCents,
      allowed_postal_codes: settings.allowedPostalCodes,
      service_area_copy: settings.serviceAreaCopy,
    },
    p_windows: windows.map((window) => ({
      id: window.id || null,
      label: window.label,
      starts_at: window.startsAt,
      ends_at: window.endsAt,
      capacity: window.capacity,
      remove: window.remove,
    })),
    p_actor_email: admin.email,
  });

  if (error) {
    const conflict = /reserved orders|cannot be removed|cannot be lower/i.test(
      error.message,
    );
    return NextResponse.json(
      { error: error.message },
      { status: conflict ? 409 : 400 },
    );
  }

  revalidateDeliveryRoutes();

  return NextResponse.json(await getDeliveryAdminData(weeklyMenuId));
}
