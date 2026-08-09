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
  generation_key?: string | null;
  source_weekly_menu_id?: string | null;
};

type DeliveryWindowExistingRow = {
  id: string;
  weekly_menu_id: string;
  label: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  reserved: number;
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

async function ensureAtomicRollingWeek(
  templateId: string,
  existingMenuId: string | null,
  baseName: string,
  schedule: ReturnType<typeof getRollingDeliveryWeekSchedules>[number],
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return null;

  const { data, error } = await supabase.rpc("ensure_atomic_rolling_week", {
    p_template_weekly_menu_id: templateId,
    p_existing_weekly_menu_id: existingMenuId,
    p_name: formatWeekName(baseName, schedule.deliveryStartsAt),
    p_generation_key: getGenerationKey(templateId, schedule.startsAt),
    p_order_cutoff_at: schedule.orderCutoffAt.toISOString(),
    p_starts_at: schedule.startsAt.toISOString(),
    p_ends_at: schedule.endsAt.toISOString(),
    p_delivery_label: formatSundayDeliveryWindowLabel(
      schedule.deliveryStartsAt,
      schedule.deliveryEndsAt,
    ),
    p_delivery_starts_at: schedule.deliveryStartsAt.toISOString(),
    p_delivery_ends_at: schedule.deliveryEndsAt.toISOString(),
    p_delivery_capacity: DEFAULT_SUNDAY_DELIVERY_CAPACITY,
  });
  if (error) {
    console.error("[supabase] atomic rolling week save failed", error.message);
    return null;
  }

  return typeof data === "string" ? data : null;
}

async function ensureSundayDeliveryWindow(
  weeklyMenuId: string,
  schedule: ReturnType<typeof getRollingDeliveryWeekSchedules>[number],
  existingWindow?: DeliveryWindowExistingRow,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return;

  const label = formatSundayDeliveryWindowLabel(
    schedule.deliveryStartsAt,
    schedule.deliveryEndsAt,
  );
  if (existingWindow) {
    if (
      existingWindow.label === label &&
      sameTimestamp(existingWindow.starts_at, schedule.deliveryStartsAt) &&
      sameTimestamp(existingWindow.ends_at, schedule.deliveryEndsAt)
    ) {
      return;
    }

    if (existingWindow.reserved > 0) {
      console.error(
        "[supabase] Sunday delivery slot was not rescheduled because it has reservations",
        existingWindow.id,
      );
      return;
    }

    const { error } = await supabase
      .from("delivery_windows")
      .update({
        label,
        starts_at: schedule.deliveryStartsAt.toISOString(),
        ends_at: schedule.deliveryEndsAt.toISOString(),
      })
      .eq("id", existingWindow.id);
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

  const schedules = getRollingDeliveryWeekSchedules(now);
  const lookupStart = schedules[0].startsAt.toISOString();
  const lookupEnd = addWeeks(schedules[schedules.length - 1].endsAt, 1).toISOString();
  const { data: existingRows, error: existingError } = await supabase
    .from("weekly_menus")
    .select(
      "id, name, order_cutoff_at, starts_at, ends_at, published, auto_generated, generation_key, source_weekly_menu_id",
    )
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
  const manualResults: Array<{
    weeklyMenuId: string;
    schedule: ReturnType<typeof getRollingDeliveryWeekSchedules>[number];
  }> = [];
  const resultIds: string[] = [];

  for (const schedule of schedules) {
    const matchingExisting = existing.find(
      (menu) =>
        new Date(menu.starts_at).getTime() <= schedule.endsAt.getTime() &&
        schedule.startsAt.getTime() <= new Date(menu.ends_at).getTime(),
    );

    if (matchingExisting) {
      if (matchingExisting.auto_generated) {
        const sourceTemplateId =
          matchingExisting.source_weekly_menu_id ?? template.id;
        const savedMenuId = await ensureAtomicRollingWeek(
          sourceTemplateId,
          matchingExisting.id,
          template.name,
          schedule,
        );
        resultIds.push(savedMenuId ?? matchingExisting.id);
      } else {
        resultIds.push(matchingExisting.id);
        manualResults.push({
          weeklyMenuId: matchingExisting.id,
          schedule,
        });
      }
      continue;
    }

    const weeklyMenuId = await ensureAtomicRollingWeek(
      template.id,
      null,
      template.name,
      schedule,
    );
    if (weeklyMenuId) resultIds.push(weeklyMenuId);
  }

  if (!resultIds.length) return [];
  if (!manualResults.length) return resultIds;

  const { data: windowRows, error: windowError } = await supabase
    .from("delivery_windows")
    .select(
      "id, weekly_menu_id, label, starts_at, ends_at, capacity, reserved",
    )
    .in(
      "weekly_menu_id",
      manualResults.map((result) => result.weeklyMenuId),
    )
    .order("starts_at", { ascending: true });
  if (windowError) {
    console.error(
      "[supabase] Sunday delivery window lookup failed",
      windowError.message,
    );
    return resultIds;
  }

  const firstWindowByMenu = new Map<string, DeliveryWindowExistingRow>();
  for (const window of (windowRows || []) as DeliveryWindowExistingRow[]) {
    if (!firstWindowByMenu.has(window.weekly_menu_id)) {
      firstWindowByMenu.set(window.weekly_menu_id, window);
    }
  }

  await Promise.all(
    manualResults.map(({ weeklyMenuId, schedule }) =>
      ensureSundayDeliveryWindow(
        weeklyMenuId,
        schedule,
        firstWindowByMenu.get(weeklyMenuId),
      ),
    ),
  );

  return resultIds;
}
