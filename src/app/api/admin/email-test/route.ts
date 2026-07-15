import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { sendCustomerOrderConfirmation } from "@/lib/email";
import { getOwnerAlertRecipients, sendOwnerAlert } from "@/lib/owner-alerts";

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

  await sendOwnerAlert({
    type: "inquiry",
    customerName: "Bakery team",
    orderSummary: "Production owner alert test",
    notes: "Testing owner notification delivery from the admin dashboard.",
  });

  return NextResponse.json({
    ok: true,
    to,
    ownerAlertRecipients: getOwnerAlertRecipients(),
  });
}
