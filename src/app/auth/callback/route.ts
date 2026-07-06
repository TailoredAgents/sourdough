import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getSiteUrl } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type");
  const next = requestUrl.searchParams.get("next") || "/admin";
  const authError = requestUrl.searchParams.get("error");
  const authErrorCode = requestUrl.searchParams.get("error_code");
  const authErrorDescription = requestUrl.searchParams.get("error_description");
  const redirectUrl = new URL(next, getSiteUrl());

  if (authError || authErrorCode || authErrorDescription) {
    redirectUrl.pathname = "/admin/login";
    redirectUrl.searchParams.set(
      "error",
      authErrorCode || authError || "auth_error",
    );
    if (authErrorDescription) {
      redirectUrl.searchParams.set("message", authErrorDescription);
    }
    return NextResponse.redirect(redirectUrl);
  }

  if (!code) {
    if (tokenHash && type) {
      const supabase = await createSupabaseServerClient();
      if (!supabase) {
        redirectUrl.pathname = "/admin/login";
        redirectUrl.searchParams.set("error", "supabase_not_configured");
        return NextResponse.redirect(redirectUrl);
      }

      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: type as "magiclink",
      });

      if (error) {
        redirectUrl.pathname = "/admin/login";
        redirectUrl.searchParams.set("error", "session_exchange_failed");
        redirectUrl.searchParams.set("message", error.message);
        return NextResponse.redirect(redirectUrl);
      }

      return NextResponse.redirect(redirectUrl);
    }

    redirectUrl.pathname = "/admin/login";
    redirectUrl.searchParams.set("error", "missing_code");
    return NextResponse.redirect(redirectUrl);
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    redirectUrl.pathname = "/admin/login";
    redirectUrl.searchParams.set("error", "supabase_not_configured");
    return NextResponse.redirect(redirectUrl);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    redirectUrl.pathname = "/admin/login";
    redirectUrl.searchParams.set("error", "session_exchange_failed");
    redirectUrl.searchParams.set("message", error.message);
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.redirect(redirectUrl);
}
