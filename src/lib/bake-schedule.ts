export const BAKE_TIME_ZONE = "America/New_York";
export const ROLLING_ORDERING_WEEK_COUNT = 5;
export const DEFAULT_SUNDAY_DELIVERY_CAPACITY = 20;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

type LocalDateParts = {
  year: number;
  month: number;
  day: number;
  weekday: string;
};

type LocalDateTimeParts = LocalDateParts & {
  hour: number;
  minute: number;
  second: number;
};

function getZonedDateTimeParts(date: Date): LocalDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BAKE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    weekday: String(values.weekday || ""),
    hour: Number(values.hour) === 24 ? 0 : Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
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
  const actual = getZonedDateTimeParts(guess);
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

function addLocalDays(date: LocalDateParts, days: number): LocalDateParts {
  const utcDate = new Date(Date.UTC(date.year, date.month - 1, date.day));
  utcDate.setUTCDate(utcDate.getUTCDate() + days);
  return {
    year: utcDate.getUTCFullYear(),
    month: utcDate.getUTCMonth() + 1,
    day: utcDate.getUTCDate(),
    weekday: "",
  };
}

function atLocalTime(date: LocalDateParts, hour: number, minute: number) {
  return zonedDateToUtc({
    year: date.year,
    month: date.month,
    day: date.day,
    hour,
    minute,
  });
}

function getWeekStartDateParts(date: Date): LocalDateParts {
  const parts = getZonedDateTimeParts(date);
  const dayIndex = WEEKDAY_INDEX[parts.weekday] ?? 0;
  const mondayOffset = dayIndex === 0 ? -6 : 1 - dayIndex;
  return addLocalDays(parts, mondayOffset);
}

function getWeekScheduleFromMonday(monday: LocalDateParts) {
  const friday = addLocalDays(monday, 4);
  const sunday = addLocalDays(monday, 6);

  const deliveryStartsAt = atLocalTime(sunday, 15, 0);
  const deliveryEndsAt = atLocalTime(sunday, 18, 0);

  return {
    startsAt: atLocalTime(monday, 0, 0),
    endsAt: atLocalTime(sunday, 23, 59),
    orderCutoffAt: atLocalTime(friday, 0, 0),
    deliveryStartsAt,
    deliveryEndsAt,
    deliveryLabel: formatSundayDeliveryWindowLabel(deliveryStartsAt, deliveryEndsAt),
  };
}

export function addWeeks(date: Date, weeks: number) {
  return new Date(date.getTime() + weeks * 7 * DAY_MS);
}

export function getCurrentDeliveryWeekSchedule(now = new Date()) {
  return getWeekScheduleFromMonday(getWeekStartDateParts(now));
}

export function getFirstVisibleDeliveryWeekSchedule(now = new Date()) {
  const current = getCurrentDeliveryWeekSchedule(now);
  if (now >= current.deliveryEndsAt) {
    return getWeekScheduleFromMonday(addLocalDays(getWeekStartDateParts(now), 7));
  }
  return current;
}

export function getRollingDeliveryWeekSchedules(now = new Date()) {
  const first = getFirstVisibleDeliveryWeekSchedule(now);
  return Array.from({ length: ROLLING_ORDERING_WEEK_COUNT }, (_, index) =>
    getWeekScheduleFromMonday(
      addLocalDays(getWeekStartDateParts(first.startsAt), index * 7),
    ),
  );
}

export function isPastSundayDeliveryEnd(
  deliveryEndsAt?: string | null,
  now = new Date(),
) {
  if (!deliveryEndsAt) return false;
  const end = new Date(deliveryEndsAt);
  return !Number.isNaN(end.getTime()) && now >= end;
}

export function isStandardSundayDeliveryWindow(
  startsAt?: string | null,
  endsAt?: string | null,
) {
  if (!startsAt || !endsAt) return false;
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;

  const startParts = getZonedDateTimeParts(start);
  const endParts = getZonedDateTimeParts(end);
  return (
    WEEKDAY_INDEX[startParts.weekday] === 0 &&
    WEEKDAY_INDEX[endParts.weekday] === 0 &&
    startParts.hour === 15 &&
    startParts.minute === 0 &&
    endParts.hour === 18 &&
    endParts.minute === 0
  );
}

export function isRequestDeliveryWeek(
  cutoffAt?: string | null,
  deliveryEndsAt?: string | null,
  now = new Date(),
) {
  if (isPastSundayDeliveryEnd(deliveryEndsAt, now)) return false;
  if (!cutoffAt) return isAfterDefaultWeeklyCutoff(now);
  const cutoff = new Date(cutoffAt);
  return !Number.isNaN(cutoff.getTime()) && now >= cutoff;
}

export function isAfterDefaultWeeklyCutoff(now = new Date()) {
  const parts = getZonedDateTimeParts(now);
  const dayIndex = WEEKDAY_INDEX[parts.weekday] ?? 0;
  return dayIndex >= 5;
}

export function formatSundayDeliveryDateLabel(date: Date) {
  return `${new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: BAKE_TIME_ZONE,
  }).format(date)} delivery`;
}

export function formatSundayDeliveryWindowLabel(startsAt: Date, endsAt: Date) {
  const day = new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: BAKE_TIME_ZONE,
  }).format(startsAt);
  const time = new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: BAKE_TIME_ZONE,
  });

  return `${day}, ${time.format(startsAt)}-${time.format(endsAt)}`;
}
