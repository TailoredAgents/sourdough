import { NextResponse } from "next/server";
import {
  cancelBreadClubAddonCheckoutByToken,
  getBreadClubAddonCheckoutForCancellation,
} from "@/lib/bread-club/member-actions";
import { getStripe } from "@/lib/stripe";
import { getSiteUrl } from "@/lib/utils";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const addonId = url.searchParams.get("addon_id") || "";
  const token = url.searchParams.get("token") || "";
  let redirectUrl = `${getSiteUrl()}/bread-club/manage?addon=canceled`;

  if (addonId && token) {
    try {
      const checkout = await getBreadClubAddonCheckoutForCancellation(
        addonId,
        token,
      );
      if (checkout) {
        if (!checkout.sessionId) {
          await cancelBreadClubAddonCheckoutByToken(addonId, token, null);
        } else {
          const stripe = getStripe();
          if (!stripe) throw new Error("Stripe is not configured.");
          let session = await stripe.checkout.sessions.retrieve(
            checkout.sessionId,
          );
          if (session.status === "complete") {
            redirectUrl = `${getSiteUrl()}/bread-club/manage?addon=success`;
          } else {
            if (session.status === "open") {
              try {
                session = await stripe.checkout.sessions.expire(session.id);
              } catch {
                session = await stripe.checkout.sessions.retrieve(session.id);
              }
            }
            if (session.status === "expired") {
              await cancelBreadClubAddonCheckoutByToken(
                addonId,
                token,
                session.id,
              );
            }
          }
        }
      }
    } catch (error) {
      console.error("[bread-club] add-on checkout cancellation failed", error);
    }
  }

  return NextResponse.redirect(redirectUrl);
}
