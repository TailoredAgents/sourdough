import { NextResponse } from "next/server";
import { isCronRequestAuthorized } from "@/lib/cron-auth";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = getSupabaseAdminClient();
  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  if (!configured || !supabase) {
    return NextResponse.json(
      {
        ok: false,
        service: "landl-sourdough",
        database: "not_configured",
      },
      { status: 503 },
    );
  }

  const deep = new URL(request.url).searchParams.get("deep") === "1";
  if (deep && !isCronRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (deep) {
    const { data, error } = await supabase.rpc(
      "operational_schema_healthcheck",
    );
    if (error || data !== "20260808140000") {
      console.error(
        "[health] database or migration check failed",
        error?.message || "Unexpected schema version",
      );
      return NextResponse.json(
        {
          ok: false,
          service: "landl-sourdough",
          database: "unavailable_or_outdated",
        },
        { status: 503 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    service: "landl-sourdough",
    database: deep ? "reachable" : "configured",
    ...(deep ? { schemaVersion: "20260808140000" } : {}),
  });
}
