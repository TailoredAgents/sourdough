import { NextResponse } from "next/server";
import { z } from "zod";
import { checkDeliveryAddressWithRoutes } from "@/lib/delivery";
import { checkRateLimit, getRequestClientIp } from "@/lib/rate-limit";
import { getDeliverySettingsData } from "@/lib/storefront-data";

const addressSchema = z.object({
  line1: z.string().trim().max(180).optional().default(""),
  line2: z.string().trim().max(120).optional().default(""),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(20),
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
        preliminary: false,
        provider: "zip",
        providerStatus: "error",
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

  const rateLimit = await checkRateLimit({
    scope: "delivery_address_check",
    key: getRequestClientIp(request),
    limit: 30,
    windowMs: 60 * 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        eligible: false,
        preliminary: false,
        provider: "zip",
        providerStatus: "error",
        needsReview: false,
        miles: null,
        message: "Too many address checks. Please wait and try again.",
        feeCents: deliverySettings.deliveryFeeCents,
        postalCode: parsed.data.postalCode,
        allowedPostalCodes: deliverySettings.allowedPostalCodes,
      },
      { status: 429 },
    );
  }

  return NextResponse.json(
    await checkDeliveryAddressWithRoutes(parsed.data, deliverySettings),
  );
}
