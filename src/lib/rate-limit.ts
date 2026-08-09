import { createHash, timingSafeEqual } from "crypto";
import { isIP } from "net";
import { getSupabaseAdminClient } from "./supabase";

const CLOUDFLARE_ORIGIN_HEADER = "x-landl-origin-verify";

export function canBypassRateLimit(nodeEnv = process.env.NODE_ENV) {
  return nodeEnv !== "production";
}

function normalizeIp(value: string | null | undefined) {
  const candidate = value?.trim().replace(/^"|"$/g, "").slice(0, 128) || "";
  return isIP(candidate) ? candidate : null;
}

function secretsMatch(actual: string | null, expected: string | undefined) {
  if (!actual || !expected) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function getRequestClientIp(
  request: Request,
  cloudflareOriginSecret = process.env.CLOUDFLARE_ORIGIN_SECRET,
) {
  const cloudflareIp = normalizeIp(request.headers.get("cf-connecting-ip"));
  if (
    cloudflareIp &&
    secretsMatch(
      request.headers.get(CLOUDFLARE_ORIGIN_HEADER),
      cloudflareOriginSecret,
    )
  ) {
    return cloudflareIp;
  }

  // Render appends the immediate peer to X-Forwarded-For. Reading from the
  // right prevents a caller-supplied left-most value from becoming an identity.
  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  const forwardedIps = forwardedFor
    .split(",")
    .map(normalizeIp)
    .filter((value): value is string => Boolean(value));
  return forwardedIps.at(-1) || "unknown-ip";
}

export async function cleanupRateLimitEvents() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { data, error } = await supabase.rpc("cleanup_rate_limit_events");
  if (error) throw new Error(error.message);
  const deleted = Number(data);
  return Number.isSafeInteger(deleted) && deleted >= 0 ? deleted : 0;
}

export async function checkRateLimit({
  scope,
  key,
  limit,
  windowMs,
}: {
  scope: string;
  key: string;
  limit: number;
  windowMs: number;
}) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return canBypassRateLimit()
      ? { allowed: true, remaining: limit }
      : { allowed: false, remaining: 0 };
  }

  const keyHash = createHash("sha256").update(key).digest("hex");
  const { data, error } = await supabase.rpc("consume_rate_limit", {
    p_scope: scope,
    p_key_hash: keyHash,
    p_limit: limit,
    p_window_seconds: Math.max(1, Math.ceil(windowMs / 1000)),
  });

  if (error) {
    console.error("[rate-limit] consume failed", error.message);
    return canBypassRateLimit()
      ? { allowed: true, remaining: limit }
      : { allowed: false, remaining: 0 };
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result || typeof result.allowed !== "boolean") {
    console.error("[rate-limit] consume returned an invalid result");
    return canBypassRateLimit()
      ? { allowed: true, remaining: limit }
      : { allowed: false, remaining: 0 };
  }

  return {
    allowed: result.allowed,
    remaining: Math.max(Number(result.remaining) || 0, 0),
  };
}

export async function checkRateLimitChain(
  ...rules: Array<{
    scope: string;
    key: string;
    limit: number;
    windowMs: number;
  }>
) {
  let result = { allowed: true, remaining: 0 };
  for (const rule of rules) {
    result = await checkRateLimit(rule);
    if (!result.allowed) return result;
  }
  return result;
}
