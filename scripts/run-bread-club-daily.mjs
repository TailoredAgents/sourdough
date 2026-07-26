const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://www.landlsourdough.com"
).replace(/\/+$/, "");
const secret = process.env.CRON_SECRET;

if (!secret) {
  throw new Error("CRON_SECRET is required.");
}

const response = await fetch(`${siteUrl}/api/cron/bread-club`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${secret}`,
  },
});
const payload = await response.json().catch(() => ({}));

if (!response.ok || payload.ok === false) {
  throw new Error(
    payload.error ||
      `Bread Club daily job failed with HTTP ${response.status}.`,
  );
}

console.log(JSON.stringify(payload.report, null, 2));
