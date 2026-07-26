import { resolve4, resolveCname } from "node:dns/promises";
import process from "node:process";

const apex = "https://landlsourdough.com";
const www = "https://www.landlsourdough.com";
const apexHttp = "http://landlsourdough.com";
const wwwHttp = "http://www.landlsourdough.com";

const failures = [];
const diagnostics = [];

async function fetchManual(url, options = {}) {
  try {
    return {
      response: await fetch(url, {
        redirect: "manual",
        ...options,
      }),
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cause =
      error instanceof Error && error.cause
        ? ` (${error.cause instanceof Error ? error.cause.message : String(error.cause)})`
        : "";
    return {
      response: null,
      error: `${message}${cause}`,
    };
  }
}

function normalizeLocation(location) {
  if (!location) return "";
  try {
    return new URL(location, apex).toString();
  } catch {
    return location;
  }
}

function formatList(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

async function resolveDns(hostname) {
  const parts = [];

  try {
    const cname = await resolveCname(hostname);
    if (cname.length) parts.push(`CNAME ${cname.join(", ")}`);
  } catch {
    // A root domain usually has no CNAME. Missing records are handled by A lookup.
  }

  try {
    const records = await resolve4(hostname);
    parts.push(records.length ? `A ${records.join(", ")}` : "no A records");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    parts.push(`A lookup failed: ${message}`);
  }

  diagnostics.push(`${hostname}: ${parts.join("; ")}`);
}

async function checkPlainHttp(url) {
  const { response, error } = await fetchManual(url, { method: "GET" });
  if (error || !response) {
    diagnostics.push(`${url}: HTTP check failed: ${error || "unknown error"}`);
    return;
  }

  const location = normalizeLocation(response.headers.get("location"));
  diagnostics.push(
    `${url}: HTTP ${response.status}${location ? ` -> ${location}` : ""}`,
  );
}

async function collectDiagnostics() {
  await Promise.all([
    resolveDns("landlsourdough.com"),
    resolveDns("www.landlsourdough.com"),
    checkPlainHttp(apexHttp),
    checkPlainHttp(wwwHttp),
  ]);
}

async function checkApexRedirect() {
  const { response, error } = await fetchManual(apex, { method: "GET" });
  if (error || !response) {
    failures.push(`Apex domain did not complete HTTPS/TLS: ${error || "unknown error"}.`);
    return;
  }

  const location = normalizeLocation(response.headers.get("location"));
  if (![301, 302, 307, 308].includes(response.status) || location !== `${www}/`) {
    failures.push(
      `Apex domain must redirect to ${www}/. It returned ${response.status} to ${
        location || "an empty location"
      }.`,
    );
  }
}

async function checkWww() {
  const { response, error } = await fetchManual(www, { method: "GET" });
  if (error || !response) {
    failures.push(`Canonical WWW domain did not load: ${error || "unknown error"}.`);
    return;
  }

  if (!response.ok) {
    failures.push(`Canonical WWW domain returned HTTP ${response.status}.`);
  }
}

async function checkHealth() {
  const { response, error } = await fetchManual(`${www}/api/health`, {
    method: "GET",
  });
  if (error || !response) {
    failures.push(`Health endpoint did not load: ${error || "unknown error"}.`);
    return;
  }
  if (!response.ok) {
    failures.push(`/api/health returned HTTP ${response.status}.`);
    return;
  }

  try {
    const payload = await response.json();
    if (payload?.ok !== true) {
      failures.push("/api/health did not return { ok: true }.");
    }
  } catch {
    failures.push("/api/health did not return JSON.");
  }
}

async function checkSitemap() {
  const { response, error } = await fetchManual(`${www}/sitemap.xml`, {
    method: "GET",
  });
  if (error || !response) {
    failures.push(`Sitemap did not load: ${error || "unknown error"}.`);
    return;
  }
  if (!response.ok) {
    failures.push(`/sitemap.xml returned HTTP ${response.status}.`);
    return;
  }

  const sitemap = await response.text();
  if (!sitemap.includes("<loc>https://www.landlsourdough.com</loc>")) {
    failures.push("Sitemap is missing the canonical WWW homepage URL.");
  }
  if (sitemap.includes("<loc>https://landlsourdough.com")) {
    failures.push("Sitemap should not contain apex URLs.");
  }
}

await checkApexRedirect();
await checkWww();
await checkHealth();
await checkSitemap();

if (failures.length) {
  await collectDiagnostics();
  console.error("Domain readiness check failed:");
  console.error(formatList(failures));
  if (diagnostics.length) {
    console.error("\nDiagnostics:");
    console.error(formatList(diagnostics));
  }
  process.exit(1);
}

console.log("Domain readiness check passed.");
