import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { rejectCrossOriginMutation } from "@/lib/request-security";
import {
  customerMessageReplySchema,
  customerMessageStatusSchema,
  getCustomerMessagesPageData,
  sendCustomerMessageReply,
  updateCustomerMessageStatus,
} from "@/lib/customer-messages";

function parseOffset(request: Request) {
  const value = new URL(request.url).searchParams.get("offset");
  if (value === null) return 0;
  const offset = Number(value);
  return Number.isSafeInteger(offset) && offset >= 0 && offset <= 100_000
    ? offset
    : null;
}

export async function GET(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin authorization is required." },
      { status: 401 },
    );
  }

  const offset = parseOffset(request);
  if (offset === null) {
    return NextResponse.json({ error: "Message page offset is invalid." }, { status: 400 });
  }

  return NextResponse.json(await getCustomerMessagesPageData({ offset }));
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = customerMessageStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid message update." },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(
      await updateCustomerMessageStatus(parsed.data.id, parsed.data.status),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Message could not be updated.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;

  const admin = await getCurrentAdmin();
  if (!admin) {
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
  const parsed = customerMessageReplySchema.safeParse(body);
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
