import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/admin-auth";
import {
  customerMessageReplySchema,
  customerMessageStatusSchema,
  getCustomerMessagesData,
  sendCustomerMessageReply,
  updateCustomerMessageStatus,
} from "@/lib/customer-messages";

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin authorization is required." },
      { status: 401 },
    );
  }

  return NextResponse.json({ messages: await getCustomerMessagesData() });
}

export async function PATCH(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin authorization is required." },
      { status: 401 },
    );
  }

  const parsed = customerMessageStatusSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid message update." },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({
      messages: await updateCustomerMessageStatus(
        parsed.data.id,
        parsed.data.status,
      ),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Message could not be updated.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin authorization is required." },
      { status: 401 },
    );
  }

  const parsed = customerMessageReplySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid customer reply." },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(
      await sendCustomerMessageReply({
        ...parsed.data,
        adminEmail: admin.email,
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Reply could not be sent.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
