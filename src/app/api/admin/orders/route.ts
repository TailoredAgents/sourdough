import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { rejectCrossOriginMutation } from "@/lib/request-security";
import {
  acceptApprovalOrder,
  denyApprovalOrderWithRefund,
  getAdminOrdersData,
  moveApprovalOrderToNextWeek,
  orderApprovalActionSchema,
  orderStatusUpdateSchema,
  updateAdminOrderStatus,
} from "@/lib/order-admin";

const weeklyMenuIdSchema = z.string().uuid();

function parseWeeklyMenuId(request: Request) {
  const value = new URL(request.url).searchParams.get("weeklyMenuId");
  if (value === null) {
    return { success: true as const, weeklyMenuId: null };
  }

  const parsed = weeklyMenuIdSchema.safeParse(value);
  return parsed.success
    ? { success: true as const, weeklyMenuId: parsed.data }
    : { success: false as const, weeklyMenuId: null };
}

async function getResponseOrders(
  weeklyMenuId: string | null,
  fallbackOrders: Awaited<ReturnType<typeof getAdminOrdersData>>,
) {
  return weeklyMenuId
    ? getAdminOrdersData({ weeklyMenuId, limit: 500 })
    : fallbackOrders;
}

export async function GET(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin authorization is required." },
      { status: 401 },
    );
  }

  const menuSelection = parseWeeklyMenuId(request);
  if (!menuSelection.success) {
    return NextResponse.json(
      { error: "Delivery week must be a valid ID." },
      { status: 400 },
    );
  }

  return NextResponse.json({
    orders: menuSelection.weeklyMenuId
      ? await getAdminOrdersData({
          weeklyMenuId: menuSelection.weeklyMenuId,
          limit: 500,
        })
      : await getAdminOrdersData(),
  });
}

export async function PATCH(request: Request) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;

  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin authorization is required." },
      { status: 401 },
    );
  }

  const menuSelection = parseWeeklyMenuId(request);
  if (!menuSelection.success) {
    return NextResponse.json(
      { error: "Delivery week must be a valid ID." },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const approvalAction = orderApprovalActionSchema.safeParse(body);
  if (approvalAction.success) {
    try {
      if (approvalAction.data.action === "accept_request") {
        const orders = await acceptApprovalOrder(
          approvalAction.data.id,
          admin.email,
          menuSelection.weeklyMenuId,
        );
        return NextResponse.json({
          orders: await getResponseOrders(
            menuSelection.weeklyMenuId,
            orders,
          ),
        });
      }
      if (approvalAction.data.action === "deny_refund") {
        const orders = await denyApprovalOrderWithRefund(
          approvalAction.data.id,
          admin.email,
          menuSelection.weeklyMenuId,
        );
        return NextResponse.json({
          orders: await getResponseOrders(
            menuSelection.weeklyMenuId,
            orders,
          ),
        });
      }
      const orders = await moveApprovalOrderToNextWeek(
        approvalAction.data.id,
        approvalAction.data.targetDeliveryWindowId,
        admin.email,
        menuSelection.weeklyMenuId,
      );
      return NextResponse.json({
        orders: await getResponseOrders(
          menuSelection.weeklyMenuId,
          orders,
        ),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Order could not be updated.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  const parsed = orderStatusUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid order update." },
      { status: 400 },
    );
  }

  try {
    const result = await updateAdminOrderStatus(
      parsed.data.id,
      parsed.data.status,
      admin.email,
      menuSelection.weeklyMenuId,
    );
    return NextResponse.json({
      orders: await getResponseOrders(
        menuSelection.weeklyMenuId,
        result.orders,
      ),
      completionNotification: result.completionNotification,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Order could not be updated.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
