import { NextResponse } from "next/server";
import { consumeBreadClubMagicLink } from "@/lib/bread-club/auth";
import {
  BREAD_CLUB_SESSION_COOKIE,
} from "@/lib/bread-club/config";
import { getSiteUrl } from "@/lib/utils";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!token) {
    return NextResponse.redirect(
      `${getSiteUrl()}/bread-club/manage?access=invalid`,
    );
  }

  try {
    const session = await consumeBreadClubMagicLink(token);
    if (!session) {
      return NextResponse.redirect(
        `${getSiteUrl()}/bread-club/manage?access=expired`,
      );
    }

    const response = NextResponse.redirect(
      `${getSiteUrl()}/bread-club/manage`,
    );
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
    );
  }
}
