import { NextResponse } from "next/server";
import { revokeCurrentBreadClubSession } from "@/lib/bread-club/auth";
import { BREAD_CLUB_SESSION_COOKIE } from "@/lib/bread-club/config";
import { getSiteUrl } from "@/lib/utils";

export async function POST() {
  await revokeCurrentBreadClubSession();
  const response = NextResponse.redirect(
    `${getSiteUrl()}/bread-club/manage`,
  );
  response.cookies.set(BREAD_CLUB_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
  return response;
}
