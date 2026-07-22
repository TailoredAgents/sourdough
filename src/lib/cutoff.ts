const TIME_ZONE = "America/New_York";

function isAfterDefaultWeeklyCutoff(now = new Date()) {
  const day = now.getDay();
  const hour = now.getHours();
  const minute = now.getMinutes();
  return day > 4 || (day === 4 && (hour > 20 || (hour === 20 && minute >= 0)));
}

function getZonedDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
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
  };
}

function getLocalWeekStartKey(date: Date) {
  const parts = getZonedDateParts(date);
  const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    parts.weekday,
  );
  const mondayOffset = dayIndex === 0 ? -6 : 1 - dayIndex;
  const localDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  localDate.setUTCDate(localDate.getUTCDate() + mondayOffset);
  return localDate.toISOString().slice(0, 10);
}

export function isAfterWeeklyCutoff(cutoffAt?: string | null, now = new Date()) {
  if (!cutoffAt) return isAfterDefaultWeeklyCutoff(now);
  const cutoff = new Date(cutoffAt);
  if (Number.isNaN(cutoff.getTime())) return isAfterDefaultWeeklyCutoff(now);
  return now >= cutoff;
}

export function isCurrentLocalWeek(dateValue?: string | null, now = new Date()) {
  if (!dateValue) return false;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;
  return getLocalWeekStartKey(date) === getLocalWeekStartKey(now);
}

export function getCutoffMessage(cutoffAt?: string | null, now = new Date()) {
  if (isAfterWeeklyCutoff(cutoffAt, now)) {
    return "Online checkout is closed for this bake. Send a request and we will reply with current availability.";
  }

  if (!cutoffAt) return "Order by Thursday at 8:00 PM for next week's local delivery.";

  const cutoff = new Date(cutoffAt);
  if (Number.isNaN(cutoff.getTime())) {
    return "Order by Thursday at 8:00 PM for next week's local delivery.";
  }

  return `Order by ${new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(cutoff)} for this bake drop.`;
}
