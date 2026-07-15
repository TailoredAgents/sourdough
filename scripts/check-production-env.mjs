import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

const envFile = process.argv.includes("--no-env-file")
  ? null
  : process.argv
      .find((arg) => arg.startsWith("--env-file="))
      ?.replace("--env-file=", "") || ".env.local";

function loadEnvFile(path) {
  if (!path || !existsSync(path)) return;

  const content = readFileSync(path, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) process.env[key] = value;
  }
}

function valueFor(key) {
  return process.env[key]?.trim() || "";
}

function isPlaceholder(value) {
  return /^(your-|owner@example\.com$|https:\/\/your-|postgresql:\/\/postgres:your-password@)/i.test(
    value,
  );
}

function hasValue(key) {
  const value = valueFor(key);
  return Boolean(value) && !isPlaceholder(value);
}

function formatList(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

function requireValue(key, label = key) {
  if (!hasValue(key)) {
    failures.push(`${label} is missing, blank, or still a placeholder.`);
  }
}

function requireUrl(key, expectedProtocol = "https:") {
  const value = valueFor(key);
  requireValue(key);
  if (!value || isPlaceholder(value)) return;
  try {
    const url = new URL(value);
    if (url.protocol !== expectedProtocol) {
      failures.push(`${key} must use ${expectedProtocol.replace(":", "")}.`);
    }
  } catch {
    failures.push(`${key} must be a valid URL.`);
  }
}

function requireExactValue(key, expected) {
  const value = valueFor(key);
  requireValue(key);
  if (value && value !== expected) {
    failures.push(`${key} must be ${expected}.`);
  }
}

function requireSiteUrl(key, expectedHostname) {
  const value = valueFor(key);
  requireUrl(key);
  if (!value || isPlaceholder(value)) return;

  try {
    const url = new URL(value);
    if (url.hostname !== expectedHostname) {
      failures.push(`${key} must use hostname ${expectedHostname}.`);
    }
    if (url.pathname !== "/" || url.search || url.hash) {
      failures.push(`${key} must be the bare site origin with no path, query, or hash.`);
    }
  } catch {
    // requireUrl already reports malformed URLs.
  }
}

function requireDatabaseUrl(key) {
  const value = valueFor(key);
  requireValue(key);
  if (!value || isPlaceholder(value)) return;

  try {
    const url = new URL(value);
    if (!["postgresql:", "postgres:"].includes(url.protocol)) {
      failures.push(`${key} must be a PostgreSQL connection string.`);
    }
    if (!url.hostname || !url.username || !url.pathname || url.pathname === "/") {
      failures.push(`${key} must include database host, user, and database name.`);
    }
  } catch {
    failures.push(`${key} must be a valid PostgreSQL connection string.`);
  }
}

function requireContains(key, expected) {
  const value = valueFor(key);
  requireValue(key);
  if (value && !value.includes(expected)) {
    failures.push(`${key} must include ${expected}.`);
  }
}

function requirePrefix(key, prefixes) {
  const value = valueFor(key);
  requireValue(key);
  if (value && !prefixes.some((prefix) => value.startsWith(prefix))) {
    failures.push(`${key} must start with ${prefixes.join(" or ")}.`);
  }
}

function requireEmailList(key) {
  const value = valueFor(key);
  requireValue(key);
  if (!value || isPlaceholder(value)) return;

  const emails = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (!emails.length || emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    failures.push(`${key} must be a comma-separated list of email addresses.`);
  }
}

function requireOptionalEmailList(key) {
  const value = valueFor(key);
  if (!value) return;

  const emails = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (!emails.length || emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    failures.push(`${key} must be a comma-separated list of email addresses.`);
  }
}

function requireInteger(key, { min = Number.MIN_SAFE_INTEGER } = {}) {
  const value = valueFor(key);
  requireValue(key);
  if (!value || isPlaceholder(value)) return;

  if (!/^\d+$/.test(value)) {
    failures.push(`${key} must be an integer.`);
    return;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min) {
    failures.push(`${key} must be at least ${min}.`);
  }
}

function requireZipList(key) {
  const value = valueFor(key);
  requireValue(key);
  if (!value || isPlaceholder(value)) return;

  const zips = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (!zips.length || zips.some((zip) => !/^\d{5}$/.test(zip))) {
    failures.push(`${key} must be a comma-separated list of 5-digit ZIP codes.`);
  }
}

function warnIfMissing(key, reason) {
  if (!hasValue(key)) warnings.push(`${key}: ${reason}`);
}

loadEnvFile(envFile);

const failures = [];
const warnings = [];

requireExactValue("NODE_ENV", "production");
requireSiteUrl("NEXT_PUBLIC_SITE_URL", "landlsourdough.com");
requireUrl("NEXT_PUBLIC_SUPABASE_URL");
requireValue("NEXT_PUBLIC_SUPABASE_ANON_KEY");
requireValue("SUPABASE_SERVICE_ROLE_KEY");
requireDatabaseUrl("SUPABASE_DB_URL");
requireEmailList("ADMIN_EMAILS");
requireEmailList("BAKERY_EMAIL");
requireValue("RESEND_API_KEY");
requireContains("RESEND_FROM", "orders@landlsourdough.com");
if (hasValue("OWNER_ALERTS_ENABLED")) {
  requireOptionalEmailList("OWNER_ALERT_EMAIL");
  requireOptionalEmailList("OWNER_ALERT_SMS_EMAIL");
  if (!hasValue("OWNER_ALERT_EMAIL") && !hasValue("OWNER_ALERT_SMS_EMAIL")) {
    failures.push(
      "OWNER_ALERT_EMAIL or OWNER_ALERT_SMS_EMAIL is required when OWNER_ALERTS_ENABLED is set.",
    );
  }
}
requirePrefix("STRIPE_SECRET_KEY", ["sk_test_", "sk_live_"]);
requirePrefix("STRIPE_WEBHOOK_SECRET", ["whsec_"]);
requireValue("OPENAI_MODEL");
requireInteger("DELIVERY_FEE_CENTS", { min: 0 });
requireZipList("DELIVERY_ALLOWED_POSTAL_CODES");
requireValue("DELIVERY_SERVICE_AREA_COPY");

warnIfMissing(
  "OPENAI_API_KEY",
  "chat and admin draft routes will use deterministic fallback replies.",
);
warnIfMissing(
  "NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION",
  "Google Search Console verification will be missing.",
);
warnIfMissing(
  "NEXT_PUBLIC_BING_SITE_VERIFICATION",
  "Bing Webmaster Tools verification will be missing.",
);
if (
  !hasValue("NEXT_PUBLIC_GA_MEASUREMENT_ID") &&
  !hasValue("NEXT_PUBLIC_GTM_ID") &&
  !hasValue("NEXT_PUBLIC_PLAUSIBLE_DOMAIN")
) {
  warnings.push("No analytics provider env var is configured.");
}

if (failures.length) {
  console.error("Production environment check failed:");
  console.error(formatList(failures));
  if (warnings.length) {
    console.error("\nWarnings:");
    console.error(formatList(warnings));
  }
  process.exit(1);
}

console.log("Production environment check passed.");
if (warnings.length) {
  console.log("\nWarnings:");
  console.log(formatList(warnings));
}
