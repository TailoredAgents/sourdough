import { NextResponse } from "next/server";
import { z } from "zod";
import { checkDeliveryAddress } from "@/lib/delivery";

const addressSchema = z.object({
  line1: z.string().optional().default(""),
  line2: z.string().optional().default(""),
  city: z.string().min(1),
  state: z.string().min(1),
  postalCode: z.string().min(3),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = addressSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        eligible: false,
        needsReview: false,
        miles: null,
        message: "Please enter a complete delivery address.",
        feeCents: 0,
      },
      { status: 400 },
    );
  }

  return NextResponse.json(checkDeliveryAddress(parsed.data));
}
