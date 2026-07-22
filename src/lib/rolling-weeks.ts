import {
  DEFAULT_SUNDAY_DELIVERY_CAPACITY,
  addWeeks,
  formatSundayDeliveryWindowLabel,
  getRollingDeliveryWeekSchedules,
} from "./bake-schedule";
import { getSupabaseAdminClient } from "./supabase";

type WeeklyMenuTemplateRow = {
  id: string;
  name: string;
  published: boolean;
  auto_generated?: boolean | null;
};

type WeeklyMenuExistingRow = WeeklyMenuTemplateRow & {
  order_cutoff_at: string;
  starts_at: string;
  ends_at: string;
};

type WeeklyMenuItemTemplateRow = {
  product_id: string;
  available_quantity: number;
  sold_quantity: number;
  featured: boolean;
  unavailable: boolean | null;
};

function getGenerationKey(templateId: string, startsAt: Date) {
  return `${templateId}:sunday:${startsAt.toISOString().slice(0, 10)}`;
}

function formatWeekName(baseName: string, deliveryStartsAt: Date) {
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
  }).format(deliveryStartsAt);
  const cleaned = baseName
    .replace(/\s+-\s+Week of .+$/i, "")
    .replace(/\s+-\s+Sunday delivery .+$/i, "");
  return `${cleaned} - Sunday delivery ${label}`;
}

function sameTimestamp(left: string, right: Date) {
  return new Date(left).getTime() === right.getTime();
}

async function syncMenuSchedule(
  menu: WeeklyMenuExistingRow,
  schedule: ReturnType<typeof getRollingDeliveryWeekSchedules>[number],
) {
  if (
    sameTimestamp(menu.order_cutoff_at, schedule.orderCutoffAt) &&
    sameTimestamp(menu.starts_at, schedule.startsAt) &&
    sameTimestamp(menu.ends_at, schedule.endsAt)
  ) {
    return;
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) return;

  const { error } = await supabase
    .from("weekly_menus")
    .update({
      order_cutoff_at: schedule.orderCutoffAt.toISOString(),
      starts_at: schedule.startsAt.toISOString(),
      ends_at: schedule.endsAt.toISOString(),
    })
    .eq("id", menu.id);

  if (error) {
    console.error("[supabase] rolling menu schedule update failed", error.message);
  }
}

async function ensureSundayDeliveryWindow(
  weeklyMenuId: string,
  schedule: ReturnType<typeof getRollingDeliveryWeekSchedules>[number],
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return;

  const label = formatSundayDeliveryWindowLabel(
    schedule.deliveryStartsAt,
    schedule.deliveryEndsAt,
  );
  const { data: existing, error: existingError } = await supabase
    .from("delivery_windows")
    .select("id, starts_at, ends_at, capacity, reserved")
    .eq("weekly_menu_id", weeklyMenuId)
    .eq("starts_at", schedule.deliveryStartsAt.toISOString())
    .maybeSingle();

  if (existingError) {
    console.error("[supabase] Sunday delivery window lookup failed", existingError.message);
    return;
  }

  if (existing) {
    const { error } = await supabase
      .from("delivery_windows")
      .update({
        label,
        starts_at: schedule.deliveryStartsAt.toISOString(),
        ends_at: schedule.deliveryEndsAt.toISOString(),
        capacity: Math.max(Number(existing.capacity || 0), DEFAULT_SUNDAY_DELIVERY_CAPACITY),
      })
      .eq("id", existing.id);
    if (error) console.error("[supabase] Sunday delivery window update failed", error.message);
    return;
  }

  const { error } = await supabase.from("delivery_windows").insert({
    weekly_menu_id: weeklyMenuId,
    label,
    starts_at: schedule.deliveryStartsAt.toISOString(),
    ends_at: schedule.deliveryEndsAt.toISOString(),
    capacity: DEFAULT_SUNDAY_DELIVERY_CAPACITY,
    reserved: 0,
  });
  if (error) console.error("[supabase] Sunday delivery window creation failed", error.message);
}

export async function ensureRollingWeeklyMenus(now = new Date()) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return [];

  const { data: templateRows, error: templateError } = await supabase
    .from("weekly_menus")
    .select("id, name, published, auto_generated")
    .eq("published", true)
    .order("auto_generated", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(20);

  if (templateError) {
    console.error("[supabase] rolling menu template lookup failed", templateError.message);
    return [];
  }

  const templates = (templateRows || []) as WeeklyMenuTemplateRow[];
  const template = templates.find((menu) => !menu.auto_generated) ?? templates[0];
  if (!template) return [];

  const { data: itemRows, error: itemError } = await supabase
    .from("weekly_menu_items")
    .select("product_id, available_quantity, sold_quantity, featured, unavailable")
    .eq("weekly_menu_id", template.id);
  if (itemError) {
    console.error("[supabase] rolling menu item template lookup failed", itemError.message);
    return [];
  }

  const schedules = getRollingDeliveryWeekSchedules(now);
  const lookupStart = schedules[0].startsAt.toISOString();
  const lookupEnd = addWeeks(schedules[schedules.length - 1].endsAt, 1).toISOString();
  const { data: existingRows, error: existingError } = await supabase
    .from("weekly_menus")
    .select("id, name, order_cutoff_at, starts_at, ends_at, published, auto_generated")
    .eq("published", true)
    .gte("ends_at", lookupStart)
    .lte("starts_at", lookupEnd)
    .order("starts_at", { ascending: true });

  if (existingError) {
    console.error("[supabase] rolling menu existing lookup failed", existingError.message);
    return [];
  }

  const existing = ((existingRows || []) as WeeklyMenuExistingRow[]).filter(
    (menu) => new Date(menu.ends_at).getTime() >= now.getTime(),
  );
  const resultIds: string[] = [];

  for (const schedule of schedules) {
    const matchingExisting = existing.find(
      (menu) =>
        new Date(menu.starts_at).getTime() <= schedule.endsAt.getTime() &&
        schedule.startsAt.getTime() <= new Date(menu.ends_at).getTime(),
    );

    if (matchingExisting) {
      await syncMenuSchedule(matchingExisting, schedule);
      await ensureSundayDeliveryWindow(matchingExisting.id, schedule);
      resultIds.push(matchingExisting.id);
      continue;
    }

    const { data: createdMenu, error: createError } = await supabase
      .from("weekly_menus")
      .insert({
        name: formatWeekName(template.name, schedule.deliveryStartsAt),
        order_cutoff_at: schedule.orderCutoffAt.toISOString(),
        starts_at: schedule.startsAt.toISOString(),
        ends_at: schedule.endsAt.toISOString(),
        published: true,
        auto_generated: true,
        generation_key: getGenerationKey(template.id, schedule.startsAt),
        source_weekly_menu_id: template.id,
      })
      .select("id")
      .single();

    if (createError) {
      console.error("[supabase] rolling menu creation failed", createError.message);
      continue;
    }

    const weeklyMenuId = createdMenu.id as string;
    resultIds.push(weeklyMenuId);

    const items = ((itemRows || []) as WeeklyMenuItemTemplateRow[]).map((item) => ({
      weekly_menu_id: weeklyMenuId,
      product_id: item.product_id,
      available_quantity: item.available_quantity,
      sold_quantity: 0,
      featured: item.featured,
      unavailable: Boolean(item.unavailable),
    }));
    if (items.length) {
      const { error } = await supabase.from("weekly_menu_items").insert(items);
      if (error) console.error("[supabase] rolling menu items creation failed", error.message);
    }

    await ensureSundayDeliveryWindow(weeklyMenuId, schedule);
  }

  return resultIds;
}
