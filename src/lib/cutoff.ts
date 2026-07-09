function isAfterDefaultWeeklyCutoff(now = new Date()) {
  const day = now.getDay();
  const hour = now.getHours();
  const minute = now.getMinutes();
  return day > 4 || (day === 4 && (hour > 20 || (hour === 20 && minute >= 0)));
}

export function isAfterWeeklyCutoff(cutoffAt?: string | null, now = new Date()) {
  if (!cutoffAt) return isAfterDefaultWeeklyCutoff(now);
  const cutoff = new Date(cutoffAt);
  if (Number.isNaN(cutoff.getTime())) return isAfterDefaultWeeklyCutoff(now);
  return now >= cutoff;
}

export function getCutoffMessage(cutoffAt?: string | null, now = new Date()) {
  if (isAfterWeeklyCutoff(cutoffAt, now)) {
    return "The weekly order cutoff has passed. Send a last-minute request and the bakery will confirm what is possible.";
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
