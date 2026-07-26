import { NextResponse } from "next/server";
import {
  configureBreadClubStripeInfrastructure,
  syncBreadClubStripeCatalog,
} from "@/lib/bread-club/stripe-sync";
import { isBreadClubPublicEnabled } from "@/lib/bread-club/config";
import { isCronRequestAuthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (isBreadClubPublicEnabled()) {
    return NextResponse.json(
      {
        error:
          "Disable public Bread Club enrollment before changing Stripe infrastructure.",
      },
      { status: 409 },
    );
  }

  try {
    const catalog = await syncBreadClubStripeCatalog();
    const infrastructure =
      await configureBreadClubStripeInfrastructure();
    return NextResponse.json({
      ok: true,
      catalog,
      infrastructure,
      signingSecretAction: infrastructure.webhookSecret
        ? "Set this new value as STRIPE_WEBHOOK_SECRET in Render before testing."
        : "No new signing secret was issued. Confirm Render already has the secret for this endpoint.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Bread Club Stripe setup failed.",
      },
      { status: 500 },
    );
  }
}
