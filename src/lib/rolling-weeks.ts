import { getSupabaseAdminClient } from "./supabase";

const ROLLING_WEEK_COUNT = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const TIME_ZONE = "America/New_York";

type WeeklyMenuTemplateRow = {
  id: string;
  name: string;
  order_cutoff_at: string;
  starts_at: string;
  ends_at: string;
  published: boolean;
  auto_generated?: boolean | null;
};

type WeeklyMenuItemTemplateRow = {
  product_id: string;
  available_quantity: number;
  sold_quantity: number;
  featured: boolean;
  unavailable: boolean | null;
};

type DeliveryWindowTemplateRow = {
  label: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  reserved: number;
};

function addWeeks(value: string, weeks: number) {
  return new Date(new Date(value).getTime() + weeks * WEEK_MS);
}

function getTimeZoneParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour === 24 ? 0 : values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function zonedDateToUtc({
  year,
  month,
  day,
  hour,
  minute,
}: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  const actual = getTimeZoneParts(guess);
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const actualUtc = Date.UTC(
    actual.year,
    actual.month - 1,
    actual.day,
    actual.hour,
    actual.minute,
    actual.second,
    0,
  );

  return new Date(guess.getTime() + (desiredUtc - actualUtc));
}

function thursdayCutoffForDeliveryWeek(startsAt: Date) {
  const parts = getTimeZoneParts(startsAt);
  const localNoon = zonedDateToUtc({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: 12,
    minute: 0,
  });
  const localDay = getTimeZoneParts(localNoon);
  const localDate = new Date(Date.UTC(localDay.year, localDay.month - 1, localDay.day));
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "short",
  }).format(startsAt);
  const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  const daysUntilThursday = 4 - dayIndex;
  localDate.setUTCDate(localDate.getUTCDate() + daysUntilThursday);

  return zonedDateToUtc({
    year: localDate.getUTCFullYear(),
    month: localDate.getUTCMonth() + 1,
    day: localDate.getUTCDate(),
    hour: 20,
    minute: 0,
  });
}

function formatWeekName(baseName: string, startsAt: Date) {
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    month: "short",
    day: "numeric",
  }).format(startsAt);
  const cleaned = baseName.replace(/\s+-\s+Week of .+$/i, "");
  return `${cleaned} - Week of ${label}`;
}

function formatDeliveryWindowLabel(startsAt: Date, endsAt: Date) {
  const day = new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: TIME_ZONE,
  }).format(startsAt);
  const time = new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  });

  return `${day}, ${time.format(startsAt)}-${time.format(endsAt)}`;
}

function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart.getTime() <= bEnd.getTime() && bStart.getTime() <= aEnd.getTime();
}

function getFirstRollingTarget(template: WeeklyMenuTemplateRow, now: Date) {
  let weeks = 0;
  while (addWeeks(template.ends_at, weeks).getTime() < now.getTime()) {
    weeks += 1;
  }
  return weeks;
}

export async function ensureRollingWeeklyMenus(now = new Date()) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return [];

  const { data: templateRows, error: templateError } = await supabase
    .from("weekly_menus")
    .select("id, name, order_cutoff_at, starts_at, ends_at, published, auto_generated")
    .eq("published", true)
    .order("auto_generated", { ascending: true })
    .order("starts_at", { ascending: false })
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

  const { data: windowRows, error: windowError } = await supabase
    .from("delivery_windows")
    .select("label, starts_at, ends_at, capacity, reserved")
    .eq("weekly_menu_id", template.id)
    .order("starts_at", { ascending: true });
  if (windowError) {
    console.error("[supabase] rolling delivery window template lookup failed", windowError.message);
    return [];
  }

  const firstOffset = getFirstRollingTarget(template, now);
  const targetRanges = Array.from({ length: ROLLING_WEEK_COUNT }, (_, index) => {
    const weekOffset = firstOffset + index;
    const startsAt = addWeeks(template.starts_at, weekOffset);
    const endsAt = addWeeks(template.ends_at, weekOffset);
    return {
      weekOffset,
      startsAt,
      endsAt,
      generationKey: `${template.id}:${startsAt.toISOString().slice(0, 10)}`,
    };
  });

  const lookupStart = new Date(targetRanges[0].startsAt.getTime() - DAY_MS).toISOString();
  const lookupEnd = new Date(
    targetRanges[targetRanges.length - 1].endsAt.getTime() + DAY_MS,
  ).toISOString();
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

  const existing = ((existingRows || []) as WeeklyMenuTemplateRow[]).filter(
    (menu) => menu.id !== template.id || new Date(menu.ends_at).getTime() >= now.getTime(),
  );
  const resultIds: string[] = [];

  for (const target of targetRanges) {
    const matchingExisting = existing.find((menu) =>
      rangesOverlap(
        target.startsAt,
        target.endsAt,
        new Date(menu.starts_at),
        new Date(menu.ends_at),
      ),
    );
    if (matchingExisting) {
      resultIds.push(matchingExisting.id);
      continue;
    }

    const cutoffAt = thursdayCutoffForDeliveryWeek(target.startsAt);
    const { data: createdMenu, error: createError } = await supabase
      .from("weekly_menus")
      .insert({
        name: formatWeekName(template.name, target.startsAt),
        order_cutoff_at: cutoffAt.toISOString(),
        starts_at: target.startsAt.toISOString(),
        ends_at: target.endsAt.toISOString(),
        published: true,
        auto_generated: true,
        generation_key: target.generationKey,
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

    const windows = ((windowRows || []) as DeliveryWindowTemplateRow[]).map((window) => {
      const startsAt = addWeeks(window.starts_at, target.weekOffset);
      const endsAt = addWeeks(window.ends_at, target.weekOffset);
      return {
        weekly_menu_id: weeklyMenuId,
        label: formatDeliveryWindowLabel(startsAt, endsAt),
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        capacity: window.capacity,
        reserved: 0,
      };
    });
    if (windows.length) {
      const { error } = await supabase.from("delivery_windows").insert(windows);
      if (error) console.error("[supabase] rolling delivery windows creation failed", error.message);
    }
  }

  return resultIds;
}
