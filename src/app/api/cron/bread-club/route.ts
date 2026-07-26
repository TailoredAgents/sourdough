import { NextResponse } from "next/server";
import { runBreadClubDaily } from "@/lib/bread-club/daily";
import { isCronRequestAuthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const report = await runBreadClubDaily();
    return NextResponse.json({
      ok: report.errors.length === 0,
      report,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Bread Club daily job failed.",
      },
      { status: 500 },
    );
  }
}
