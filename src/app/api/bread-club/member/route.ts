import { NextResponse } from "next/server";
import { z } from "zod";
import { getBreadClubSessionMembershipId } from "@/lib/bread-club/auth";
import {
  cancelBreadClubMembership,
  changeBreadClubSelection,
  createBreadClubAddonCheckout,
  redeemBreadClubCredit,
  scheduleBreadClubPlanChange,
  skipBreadClubDelivery,
  updateBreadClubAddress,
} from "@/lib/bread-club/member-actions";
import { getBreadClubMemberData } from "@/lib/bread-club/member-data";

const selectionSchema = z.array(
  z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(2),
  }),
);

const memberActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("change_selection"),
    fulfillmentId: z.string().uuid(),
    selection: selectionSchema.min(1).max(2),
  }),
  z.object({
    action: z.literal("skip"),
    fulfillmentId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("redeem_credit"),
    creditId: z.string().uuid(),
    fulfillmentId: z.string().uuid(),
    productId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("change_plan"),
    planId: z.string().uuid(),
    selection: selectionSchema.min(1).max(2),
  }),
  z.object({
    action: z.literal("update_address"),
    address: z.object({
      line1: z.string().trim().min(3).max(180),
      line2: z.string().trim().max(120).optional().default(""),
      city: z.string().trim().min(1).max(100),
      state: z.string().trim().min(2).max(20),
      postalCode: z.string().trim().regex(/^\d{5}$/),
    }),
    deliveryInstructions: z.string().trim().max(1000).default(""),
  }),
  z.object({
    action: z.literal("cancel"),
    reason: z.string().trim().max(500).default("Canceled online by member"),
  }),
  z.object({
    action: z.literal("addon_checkout"),
    fulfillmentId: z.string().uuid(),
    items: z
      .array(
        z.object({
          productId: z.string().uuid(),
          quantity: z.number().int().min(1).max(12),
        }),
      )
      .min(1)
      .max(12),
  }),
]);

async function authenticatedMembershipId() {
  return getBreadClubSessionMembershipId();
}
export async function GET() {
  const membershipId = await authenticatedMembershipId();
  if (!membershipId) {
    return NextResponse.json(
      { error: "Use a secure email link to access Bread Club." },
      { status: 401 },
    );
  }
  return NextResponse.json({
    member: await getBreadClubMemberData(membershipId),
  });
}

export async function PATCH(request: Request) {
  const membershipId = await authenticatedMembershipId();
  if (!membershipId) {
    return NextResponse.json(
      { error: "Use a secure email link to access Bread Club." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = memberActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ||
          "That Bread Club update is not valid.",
      },
      { status: 400 },
    );
  }

  try {
    switch (parsed.data.action) {
      case "change_selection":
        return NextResponse.json({
          member: await changeBreadClubSelection(
            membershipId,
            parsed.data.fulfillmentId,
            parsed.data.selection,
          ),
        });
      case "skip":
        return NextResponse.json(
          await skipBreadClubDelivery(
            membershipId,
            parsed.data.fulfillmentId,
          ),
        );
      case "redeem_credit":
        return NextResponse.json({
          member: await redeemBreadClubCredit(
            membershipId,
            parsed.data.creditId,
            parsed.data.fulfillmentId,
            parsed.data.productId,
          ),
        });
      case "change_plan":
        return NextResponse.json({
          member: await scheduleBreadClubPlanChange(
            membershipId,
            parsed.data.planId,
            parsed.data.selection,
          ),
        });
      case "update_address":
        return NextResponse.json({
          member: await updateBreadClubAddress(
            membershipId,
            parsed.data.address,
            parsed.data.deliveryInstructions,
          ),
        });
      case "cancel":
        return NextResponse.json({
          member: await cancelBreadClubMembership(
            membershipId,
            parsed.data.reason,
          ),
        });
      case "addon_checkout":
        return NextResponse.json(
          await createBreadClubAddonCheckout(
            membershipId,
            parsed.data.fulfillmentId,
            parsed.data.items,
          ),
        );
    }
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Bread Club could not be updated.",
      },
      { status: 400 },
    );
  }
}
