import { createHash } from "crypto";
import { getSupabaseAdminClient } from "./supabase";

export function canBypassRateLimit(nodeEnv = process.env.NODE_ENV) {
  return nodeEnv !== "production";
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
  const since = new Date(Date.now() - windowMs).toISOString();

  const { count, error: countError } = await supabase
    .from("rate_limit_events")
    .select("id", { count: "exact", head: true })
    .eq("scope", scope)
    .eq("key_hash", keyHash)
    .gte("created_at", since);

  if (countError) {
    console.error("[rate-limit] lookup failed", countError.message);
    return canBypassRateLimit()
      ? { allowed: true, remaining: limit }
      : { allowed: false, remaining: 0 };
  }

  if ((count || 0) >= limit) {
    return { allowed: false, remaining: 0 };
  }

  const { error: insertError } = await supabase.from("rate_limit_events").insert({
    scope,
    key_hash: keyHash,
  });

  if (insertError) {
    console.error("[rate-limit] insert failed", insertError.message);
    return canBypassRateLimit()
      ? { allowed: true, remaining: limit - (count || 0) }
      : { allowed: false, remaining: 0 };
  }

  return { allowed: true, remaining: Math.max(limit - (count || 0) - 1, 0) };
}
