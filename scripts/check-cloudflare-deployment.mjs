import assert from "node:assert/strict";

const base = new URL(process.env.DEPLOYMENT_URL || "https://www.landlsourdough.com");

async function request(path, expectedStatus = 200, options = {}) {
  const response = await fetch(new URL(path, base), {
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
    ...options,
  });
  assert.equal(response.status, expectedStatus, `${path}: HTTP ${response.status}`);
  return response;
}

// Allow a newly published version a short propagation window.
let health;
for (let attempt = 0; attempt < 6; attempt++) {
  try {
    health = await (await request("/api/health")).json();
    assert.equal(health.ok, true);
    assert.equal(health.platform, "cloudflare");
    break;
  } catch (error) {
    if (attempt === 5) throw error;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
assert.equal(health.database, "configured");

if (process.env.CRON_SECRET) {
  const deep = await (await request("/api/health?deep=1", 200, {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  })).json();
  assert.equal(deep.database, "reachable");
}

const home = await request("/");
assert.equal(home.headers.get("x-content-type-options"), "nosniff");
assert.equal(home.headers.get("x-frame-options"), "DENY");
const html = await home.text();
assert.match(html, /Luna/);
assert.match(html, /Lorelai/);
const script = html.match(/src="(\/_next\/static\/[^"?]+\.js)/)?.[1];
assert.ok(script, "Storefront must reference a client bundle");
const asset = await request(script);
assert.match(asset.headers.get("cache-control") || "", /immutable/);
await asset.arrayBuffer();

for (const path of ["/contact", "/policies", "/bread-club", "/sourdough-delivery-canton-ga"]) {
  await (await request(path)).text();
}
const manifest = await (await request("/manifest.webmanifest")).json();
assert.equal(manifest.start_url, "/");
assert.match(await (await request("/robots.txt")).text(), /Sitemap:/);
assert.match(await (await request("/sitemap.xml")).text(), /<urlset/);
await (await request("/_next/image?url=%2Fimages%2Fsourdough-hero.jpg&w=640&q=75")).arrayBuffer();
await (await request("/api/health?deep=1", 401)).text();
await (await request("/api/cron/bread-club", 401, { method: "POST" })).text();
await (await request("/api/stripe/webhook", 400, { method: "POST", body: "{}" })).text();
const admin = await request("/admin", 307);
assert.match(admin.headers.get("location") || "", /\/admin\/login/);
await admin.text();

console.log(`Cloudflare deployment checks passed: ${base.origin}`);
