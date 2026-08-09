import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import {
  BREAD_CLUB_MAGIC_LINK_MINUTES,
  BREAD_CLUB_SESSION_COOKIE,
  BREAD_CLUB_SESSION_DAYS,
} from "./config";
import { sendBreadClubMagicLink } from "./emails";
import { getRequestClientIp } from "@/lib/rate-limit";
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
  const link = `${getSiteUrl()}/bread-club/auth/confirm?token=${encodeURIComponent(rawToken)}`;
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

  const rawSession = randomBytes(32).toString("base64url");
  const expiresAt = expiresFromNow(BREAD_CLUB_SESSION_DAYS, "days");
  const { data: membershipId, error } = await supabase.rpc(
    "consume_bread_club_magic_link",
    {
      p_token_hash: tokenHash,
      p_session_hash: hashToken(rawSession),
      p_session_expires_at: expiresAt.toISOString(),
    },
  );
  if (error) throw new Error(error.message);
  if (!membershipId) return null;

  return {
    rawSession,
    membershipId: String(membershipId),
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
  const ip = getRequestClientIp(request);
  return ip === "unknown-ip" ? null : hashToken(ip);
}
