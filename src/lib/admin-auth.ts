import { redirect } from "next/navigation";
import { getSupabaseAdminClient } from "./supabase";
import { createSupabaseServerClient } from "./supabase-server";

export type CurrentAdmin = {
  id: string;
  email: string;
  source: "env" | "database";
};

function getAllowedAdminEmails() {
  return (process.env.ADMIN_EMAILS || process.env.BAKERY_EMAIL || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

async function isDatabaseAdmin(userId: string, email: string) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return false;

  const { data, error } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userId)
    .eq("email", email)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    console.error("[auth] admin lookup failed", error.message);
    return false;
  }

  return Boolean(data);
}

export async function getCurrentAdmin(): Promise<CurrentAdmin | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user?.email) return null;

  const email = user.email.toLowerCase();
  if (getAllowedAdminEmails().includes(email)) {
    return {
      id: user.id,
      email,
      source: "env",
    };
  }

  if (await isDatabaseAdmin(user.id, email)) {
    return {
      id: user.id,
      email,
      source: "database",
    };
  }

  return null;
}

export async function requireAdmin() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/admin/login");

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/admin/login");

  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/not-authorized");

  return admin;
}
