import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { sendCustomerOrderConfirmation } from "@/lib/email";

export async function POST() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin authorization is required." },
      { status: 401 },
    );
  }

  const to = process.env.BAKERY_EMAIL || admin.email;
  await sendCustomerOrderConfirmation({
    to,
    customerName: "Bakery team",
    orderSummary: "1 x Resend smoke test",
    deliveryWindow: "Production email test",
  });

  return NextResponse.json({ ok: true, to });
}
