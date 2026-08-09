import { NextResponse } from "next/server";
import { buildAdminSundayRoute } from "@/lib/admin-delivery-route";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { getAdminOrdersData } from "@/lib/order-admin";
import { getPublishedMenuId, getWeeklyMenuData } from "@/lib/storefront-data";

export async function GET(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin authorization is required." },
      { status: 401 },
    );
  }

  try {
    const requestedWeeklyMenuId = new URL(request.url).searchParams.get("weeklyMenuId");
    const weeklyMenuId = requestedWeeklyMenuId || (await getPublishedMenuId());
    if (!weeklyMenuId) {
      return NextResponse.json(
        { error: "Select a published delivery week before building a route." },
        { status: 400 },
      );
    }
    const selectedMenu = await getWeeklyMenuData(weeklyMenuId);
    if (!selectedMenu) {
      return NextResponse.json(
        { error: "That delivery week no longer exists. Choose another Sunday." },
        { status: 404 },
      );
    }
    const route = await buildAdminSundayRoute(
      await getAdminOrdersData({ weeklyMenuId, limit: 500 }),
      weeklyMenuId,
      selectedMenu.name,
    );
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
