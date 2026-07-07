export function isAfterWeeklyCutoff(now = new Date()) {
  const day = now.getDay();
  const hour = now.getHours();
  const minute = now.getMinutes();
  return day > 4 || (day === 4 && (hour > 20 || (hour === 20 && minute >= 0)));
}

export function getCutoffMessage(now = new Date()) {
  if (isAfterWeeklyCutoff(now)) {
    return "The Thursday cutoff has passed. Send a last-minute request and the bakery will confirm what is possible.";
  }

  return "Order by Thursday at 8:00 PM for next week's local delivery.";
}
