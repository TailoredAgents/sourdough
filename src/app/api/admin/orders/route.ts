import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/admin-auth";
import {
  getAdminOrdersData,
  orderStatusUpdateSchema,
  updateAdminOrderStatus,
} from "@/lib/order-admin";

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin authorization is required." },
      { status: 401 },
    );
  }

  return NextResponse.json({ orders: await getAdminOrdersData() });
}

export async function PATCH(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin authorization is required." },
      { status: 401 },
    );
  }

  const parsed = orderStatusUpdateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid order update." },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({
      orders: await updateAdminOrderStatus(parsed.data.id, parsed.data.status),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Order could not be updated.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
