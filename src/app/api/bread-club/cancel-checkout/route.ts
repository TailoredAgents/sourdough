import { NextResponse } from "next/server";
import { cancelBreadClubCheckoutByToken } from "@/lib/bread-club/records";
import { getSiteUrl } from "@/lib/utils";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const membershipId = url.searchParams.get("membership_id") || "";
  const token = url.searchParams.get("token") || "";

  if (membershipId && token) {
    try {
      await cancelBreadClubCheckoutByToken(membershipId, token);
    } catch (error) {
      console.error("[bread-club] checkout cancellation failed", error);
    }
  }

  return NextResponse.redirect(`${getSiteUrl()}/bread-club?canceled=1`);
}
