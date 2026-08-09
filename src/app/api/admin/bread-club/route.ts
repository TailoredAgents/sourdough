import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { rejectCrossOriginMutation } from "@/lib/request-security";
import {
  adminCancelBreadClubMembership,
  getBreadClubAdminData,
  refundBreadClubCycle,
  resendBreadClubAccess,
  syncBreadClubStripeForAdmin,
  updateBreadClubCapacity,
} from "@/lib/bread-club/admin";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set_capacity"),
    maxWeeklyLoafSlots: z.number().int().min(1).max(20),
  }),
  z.object({
    action: z.literal("sync_stripe"),
  }),
  z.object({
    action: z.literal("resend_access"),
    membershipId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("cancel_membership"),
    membershipId: z.string().uuid(),
    reason: z.string().trim().max(500).default("Canceled by owner"),
  }),
  z.object({
    action: z.literal("refund_cycle"),
    membershipId: z.string().uuid(),
    cycleId: z.string().uuid(),
    note: z.string().trim().max(500).default("Refunded by owner"),
  }),
]);

export async function GET() {
  if (!(await getCurrentAdmin())) {
    return NextResponse.json(
      { error: "Admin authorization is required." },
      { status: 401 },
    );
  }
  return NextResponse.json({ data: await getBreadClubAdminData() });
}
export async function POST(request: Request) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;

  if (!(await getCurrentAdmin())) {
    return NextResponse.json(
      { error: "Admin authorization is required." },
      { status: 401 },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ||
          "That Bread Club admin action is not valid.",
      },
      { status: 400 },
    );
  }

  try {
    switch (parsed.data.action) {
      case "set_capacity":
        return NextResponse.json({
          data: await updateBreadClubCapacity(
            parsed.data.maxWeeklyLoafSlots,
          ),
        });
      case "sync_stripe":
        return NextResponse.json({
          data: await syncBreadClubStripeForAdmin(),
        });
      case "resend_access":
        return NextResponse.json({
          data: await resendBreadClubAccess(
            parsed.data.membershipId,
          ),
        });
      case "cancel_membership":
        return NextResponse.json({
          data: await adminCancelBreadClubMembership(
            parsed.data.membershipId,
            parsed.data.reason,
          ),
        });
      case "refund_cycle":
        return NextResponse.json({
          data: await refundBreadClubCycle(
            parsed.data.membershipId,
            parsed.data.cycleId,
            parsed.data.note,
          ),
        });
    }
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Bread Club admin action failed.",
      },
      { status: 400 },
    );
  }
}
