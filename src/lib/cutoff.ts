import { isAfterDefaultWeeklyCutoff } from "./bake-schedule";

export function isAfterWeeklyCutoff(cutoffAt?: string | null, now = new Date()) {
  if (!cutoffAt) return isAfterDefaultWeeklyCutoff(now);
  const cutoff = new Date(cutoffAt);
  if (Number.isNaN(cutoff.getTime())) return isAfterDefaultWeeklyCutoff(now);
  return now >= cutoff;
}

export function getCutoffMessage(cutoffAt?: string | null, now = new Date()) {
  if (isAfterWeeklyCutoff(cutoffAt, now)) {
    return "This Sunday delivery is in request mode. Pay now and Grace will approve it, move it to next Sunday if you allow that, or refund it.";
  }

  if (!cutoffAt) {
    return "Order by Thursday at 11:59 PM for Sunday 3:00-6:00 PM delivery.";
  }

  const cutoff = new Date(cutoffAt);
  if (Number.isNaN(cutoff.getTime())) {
    return "Order by Thursday at 11:59 PM for Sunday 3:00-6:00 PM delivery.";
  }

  return "Order by Thursday at 11:59 PM for Sunday 3:00-6:00 PM delivery.";
}
