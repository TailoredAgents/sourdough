import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import {
  BREAD_CLUB_MAGIC_LINK_MINUTES,
  BREAD_CLUB_SESSION_COOKIE,
  BREAD_CLUB_SESSION_DAYS,
} from "./config";
import { sendBreadClubMagicLink } from "./emails";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { getSiteUrl } from "@/lib/utils";

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function expiresFromNow(amount: number, unit: "minutes" | "days") {
  const multiplier =
    unit === "minutes" ? 60 * 1000 : 24 * 60 * 60 * 1000;
  return new Date(Date.now() + amount * multiplier);
}

export async function createBreadClubMagicLink(
  email: string,
  requestIpHash: string | null,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const normalizedEmail = email.trim().toLowerCase();

  const { data: customers, error: customerError } = await supabase
    .from("customers")
    .select("id, name")
    .eq("email", normalizedEmail)
    .order("created_at", { ascending: false });
  if (customerError) throw new Error(customerError.message);
  if (!customers?.length) return false;

  const { data: membership, error: membershipError } = await supabase
    .from("bread_club_memberships")
    .select("id, customer_id")
    .in(
      "customer_id",
      customers.map((customer) => customer.id),
    )
    .in("status", ["active", "past_due", "canceling"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (membershipError) throw new Error(membershipError.message);
  if (!membership) return false;

  const rawToken = randomBytes(32).toString("base64url");
  const expiresAt = expiresFromNow(
    BREAD_CLUB_MAGIC_LINK_MINUTES,
    "minutes",
  );
  const { error: insertError } = await supabase
    .from("bread_club_magic_links")
    .insert({
      membership_id: membership.id,
      email: normalizedEmail,
      token_hash: hashToken(rawToken),
      request_ip_hash: requestIpHash,
      expires_at: expiresAt.toISOString(),
    });
  if (insertError) throw new Error(insertError.message);

  const customer = customers.find(
    (item) => String(item.id) === String(membership.customer_id),
  );
  const link = `${getSiteUrl()}/api/bread-club/auth/callback?token=${encodeURIComponent(rawToken)}`;
  await sendBreadClubMagicLink({
    to: normalizedEmail,
    customerName: String(customer?.name || "there"),
    link,
    membershipId: String(membership.id),
  });
  return true;
}

export async function consumeBreadClubMagicLink(rawToken: string) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const tokenHash = hashToken(rawToken);

  const { data: magicLink, error: lookupError } = await supabase
    .from("bread_club_magic_links")
    .select("id, membership_id, expires_at, used_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (
    !magicLink ||
    magicLink.used_at ||
    new Date(magicLink.expires_at).getTime() <= Date.now()
  ) {
    return null;
  }

  const usedAt = new Date().toISOString();
  const { data: usedRows, error: updateError } = await supabase
    .from("bread_club_magic_links")
    .update({ used_at: usedAt })
    .eq("id", magicLink.id)
    .is("used_at", null)
    .gt("expires_at", usedAt)
    .select("id");
  if (updateError) throw new Error(updateError.message);
  if (!usedRows?.length) return null;

  const rawSession = randomBytes(32).toString("base64url");
  const expiresAt = expiresFromNow(BREAD_CLUB_SESSION_DAYS, "days");
  const { error: sessionError } = await supabase
    .from("bread_club_sessions")
    .insert({
      membership_id: magicLink.membership_id,
      session_hash: hashToken(rawSession),
      expires_at: expiresAt.toISOString(),
    });
  if (sessionError) throw new Error(sessionError.message);

  return {
    rawSession,
    membershipId: String(magicLink.membership_id),
    expiresAt,
  };
}

export async function getBreadClubSessionMembershipId() {
  const cookieStore = await cookies();
  const rawSession = cookieStore.get(BREAD_CLUB_SESSION_COOKIE)?.value;
  if (!rawSession) return null;

  const supabase = getSupabaseAdminClient();
  if (!supabase) return null;
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("bread_club_sessions")
    .select("id, membership_id")
    .eq("session_hash", hashToken(rawSession))
    .is("revoked_at", null)
    .gt("expires_at", now)
    .maybeSingle();
  if (error || !data) return null;

  void supabase
    .from("bread_club_sessions")
    .update({ last_seen_at: now })
    .eq("id", data.id);
  return String(data.membership_id);
}

export async function revokeCurrentBreadClubSession() {
  const cookieStore = await cookies();
  const rawSession = cookieStore.get(BREAD_CLUB_SESSION_COOKIE)?.value;
  if (!rawSession) return;
  const supabase = getSupabaseAdminClient();
  if (!supabase) return;
  await supabase
    .from("bread_club_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("session_hash", hashToken(rawSession));
}

export function hashBreadClubRequestIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  const ip = forwarded.split(",")[0]?.trim();
  return ip ? hashToken(ip) : null;
}
