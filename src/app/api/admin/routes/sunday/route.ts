import { NextResponse } from "next/server";
import { buildAdminSundayRoute } from "@/lib/admin-delivery-route";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { getAdminOrdersData } from "@/lib/order-admin";

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin authorization is required." },
      { status: 401 },
    );
  }

  try {
    const route = await buildAdminSundayRoute(await getAdminOrdersData());
    return NextResponse.json({ route });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Sunday route could not be built.",
      },
      { status: 503 },
    );
  }
}
