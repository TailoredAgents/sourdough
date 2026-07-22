import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/admin-auth";
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
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin authorization is required." },
      { status: 401 },
    );
  }

  const parsed = deliveryAdminSchema.safeParse(await request.json());
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
  const weeklyMenuId = parsed.data.weeklyMenuId || (await getPublishedMenuId());
  if (!weeklyMenuId) {
    return NextResponse.json(
      { error: "Create and publish a weekly menu before editing Sunday delivery." },
      { status: 400 },
    );
  }

  const { error: settingsError } = await supabase.from("delivery_settings").upsert({
    id: true,
    center_lat: settings.centerLat,
    center_lng: settings.centerLng,
    radius_miles: settings.radiusMiles,
    delivery_fee_cents: settings.deliveryFeeCents,
    allowed_postal_codes: settings.allowedPostalCodes,
    service_area_copy: settings.serviceAreaCopy,
  });

  if (settingsError) {
    return NextResponse.json({ error: settingsError.message }, { status: 400 });
  }

  const windowsToRemove = windows
    .filter((window) => window.remove && window.id)
    .map((window) => window.id as string);
  if (windowsToRemove.length) {
    const { error } = await supabase
      .from("delivery_windows")
      .delete()
      .eq("weekly_menu_id", weeklyMenuId)
      .in("id", windowsToRemove);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  const windowsToSave = windows.filter((window) => !window.remove);
  const existingWindows = windowsToSave.filter((window) => window.id);
  const newWindows = windowsToSave.filter((window) => !window.id);

  for (const window of existingWindows) {
    const { error } = await supabase
      .from("delivery_windows")
      .update({
        label: window.label,
        starts_at: window.startsAt,
        ends_at: window.endsAt,
        capacity: window.capacity,
        reserved: window.reserved,
      })
      .eq("id", window.id)
      .eq("weekly_menu_id", weeklyMenuId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  if (newWindows.length) {
    const { error } = await supabase.from("delivery_windows").insert(
      newWindows.map((window) => ({
        weekly_menu_id: weeklyMenuId,
        label: window.label,
        starts_at: window.startsAt,
        ends_at: window.endsAt,
        capacity: window.capacity,
        reserved: window.reserved,
      })),
    );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  return NextResponse.json(await getDeliveryAdminData(weeklyMenuId));
}
