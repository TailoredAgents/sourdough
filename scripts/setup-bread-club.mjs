const setupUrl =
  process.env.BREAD_CLUB_SETUP_URL ||
  "http://localhost:3000/api/cron/bread-club/setup";
const secret = process.env.BREAD_CLUB_SETUP_SECRET;

if (!secret) {
  throw new Error("BREAD_CLUB_SETUP_SECRET is required.");
}

const response = await fetch(setupUrl, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${secret}`,
  },
});
const payload = await response.json().catch(() => ({}));

if (!response.ok || payload.ok === false) {
  throw new Error(
    payload.error ||
      `Bread Club setup failed with HTTP ${response.status}.`,
  );
}

console.log(JSON.stringify(payload, null, 2));
