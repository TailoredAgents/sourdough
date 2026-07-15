import { NextResponse } from "next/server";
import {
  bakeNotifySignupSchema,
  createBakeNotifySignup,
} from "@/lib/customer-messages";
import { checkRateLimit } from "@/lib/rate-limit";

function getRateLimitKey(request: Request, email: string) {
  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  const ip = forwardedFor.split(",")[0]?.trim() || "unknown-ip";
  return `${ip}:${email.toLowerCase()}`;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 },
    );
  }

  const parsed = bakeNotifySignupSchema.safeParse(body);
  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.path[0] === "postalCode"
        ? "Enter a 5-digit ZIP code or leave it blank."
        : "Please enter a valid email address.";
    return NextResponse.json(
      { error: message },
      { status: 400 },
    );
  }

  const rateLimit = await checkRateLimit({
    scope: "bake_notify_signup",
    key: getRateLimitKey(request, parsed.data.email),
    limit: 3,
    windowMs: 60 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many signup attempts. Please try again later." },
      { status: 429 },
    );
  }

  const message = await createBakeNotifySignup(parsed.data);

  return NextResponse.json({
    ok: true,
    message:
      "You are on the list. We will email you when the next bake opens.",
    id: message?.id ?? null,
  });
}
