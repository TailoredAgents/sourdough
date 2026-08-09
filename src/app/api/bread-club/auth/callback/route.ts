import { NextResponse } from "next/server";
import { consumeBreadClubMagicLink } from "@/lib/bread-club/auth";
import {
  BREAD_CLUB_SESSION_COOKIE,
} from "@/lib/bread-club/config";
import { getSiteUrl } from "@/lib/utils";
import { isSameOriginMutation } from "@/lib/request-security";

function isValidMagicToken(token: string) {
  return /^[A-Za-z0-9_-]{40,64}$/.test(token);
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") || "";
  const destination = new URL("/bread-club/auth/confirm", getSiteUrl());
  if (isValidMagicToken(token)) destination.searchParams.set("token", token);
  else destination.searchParams.set("access", "invalid");
  return NextResponse.redirect(destination);
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  let token = "";
  try {
    const form = await request.formData();
    token = String(form.get("token") || "");
  } catch {
    token = "";
  }
  if (!isValidMagicToken(token)) {
    return NextResponse.redirect(
      `${getSiteUrl()}/bread-club/manage?access=invalid`,
      303,
    );
  }

  try {
    const session = await consumeBreadClubMagicLink(token);
    if (!session) {
      return NextResponse.redirect(
        `${getSiteUrl()}/bread-club/manage?access=expired`,
        303,
      );
    }

    const response = NextResponse.redirect(`${getSiteUrl()}/bread-club/manage`, 303);
    response.cookies.set(BREAD_CLUB_SESSION_COOKIE, session.rawSession, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: session.expiresAt,
    });
    return response;
  } catch (error) {
    console.error("[bread-club] magic-link exchange failed", error);
    return NextResponse.redirect(
      `${getSiteUrl()}/bread-club/manage?access=error`,
      303,
    );
  }
}
