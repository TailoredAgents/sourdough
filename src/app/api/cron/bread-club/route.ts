import { NextResponse } from "next/server";
import { runBreadClubDaily } from "@/lib/bread-club/daily";
import { isCronRequestAuthorized } from "@/lib/cron-auth";
import { reconcileStorefrontCheckoutSessions } from "@/lib/order-reconciliation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const [report, checkoutReconciliation] = await Promise.all([
      runBreadClubDaily(),
      reconcileStorefrontCheckoutSessions(),
    ]);
    return NextResponse.json({
      ok:
        report.errors.length === 0 &&
        checkoutReconciliation.errors.length === 0,
      report,
      checkoutReconciliation,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Bakery operations job failed.",
      },
      { status: 500 },
    );
  }
}
