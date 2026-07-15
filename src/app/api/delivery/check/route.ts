import { NextResponse } from "next/server";
import { z } from "zod";
import { checkDeliveryAddress } from "@/lib/delivery";
import { getDeliverySettingsData } from "@/lib/storefront-data";

const addressSchema = z.object({
  line1: z.string().optional().default(""),
  line2: z.string().optional().default(""),
  city: z.string().min(1),
  state: z.string().min(1),
  postalCode: z.string().regex(/^\d{5}$/),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const deliverySettings = await getDeliverySettingsData();
  const parsed = addressSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        eligible: false,
        needsReview: false,
        miles: null,
        message: "Please enter a complete delivery address.",
        feeCents: deliverySettings.deliveryFeeCents,
        postalCode: null,
        allowedPostalCodes: deliverySettings.allowedPostalCodes,
      },
      { status: 400 },
    );
  }

  return NextResponse.json(checkDeliveryAddress(parsed.data, deliverySettings));
}
