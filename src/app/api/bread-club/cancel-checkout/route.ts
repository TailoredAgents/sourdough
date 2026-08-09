import { NextResponse } from "next/server";
import {
  cancelBreadClubCheckoutByToken,
  getBreadClubCheckoutForCancellation,
} from "@/lib/bread-club/records";
import { getStripe } from "@/lib/stripe";
import { getSiteUrl } from "@/lib/utils";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const membershipId = url.searchParams.get("membership_id") || "";
  const token = url.searchParams.get("token") || "";
  let redirectUrl = `${getSiteUrl()}/bread-club?canceled=1`;

  if (membershipId && token) {
    try {
      const checkout = await getBreadClubCheckoutForCancellation(
        membershipId,
        token,
      );
      if (checkout) {
        if (!checkout.sessionId) {
          await cancelBreadClubCheckoutByToken(
            checkout.membershipId,
            token,
            null,
            checkout.cycleId,
          );
        } else {
          const stripe = getStripe();
          if (!stripe) {
            throw new Error("Stripe is not configured.");
          }
          let session = await stripe.checkout.sessions.retrieve(
            checkout.sessionId,
          );
          if (session.status === "complete") {
            redirectUrl = `${getSiteUrl()}/bread-club/success?session_id=${encodeURIComponent(session.id)}`;
          } else {
            if (session.status === "open") {
              try {
                session = await stripe.checkout.sessions.expire(session.id);
              } catch {
                session = await stripe.checkout.sessions.retrieve(session.id);
              }
            }
            if (session.status === "expired") {
              await cancelBreadClubCheckoutByToken(
                checkout.membershipId,
                token,
                session.id,
                checkout.cycleId,
              );
            }
          }
        }
      }
    } catch (error) {
      console.error("[bread-club] checkout cancellation failed", error);
    }
  }

  return NextResponse.redirect(redirectUrl);
}
