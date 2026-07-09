import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { syncStripeProductCatalog } from "@/lib/stripe-catalog";

export async function POST() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin authorization is required." },
      { status: 401 },
    );
  }

  try {
    const products = await syncStripeProductCatalog();
    return NextResponse.json({ products });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Stripe catalog sync failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
