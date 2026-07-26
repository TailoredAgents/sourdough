import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createBreadClubMagicLink,
  hashBreadClubRequestIp,
} from "@/lib/bread-club/auth";
import { checkRateLimit } from "@/lib/rate-limit";

const accessSchema = z.object({
  email: z.string().trim().email().max(254),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = accessSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter the email used for Bread Club." },
      { status: 400 },
    );
  }

  const email = parsed.data.email.trim().toLowerCase();
  const rateLimit = await checkRateLimit({
    scope: "bread_club_magic_link",
    key: `${hashBreadClubRequestIp(request) || "unknown"}:${email}`,
    limit: 4,
    windowMs: 60 * 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many link requests. Please try again later." },
      { status: 429 },
    );
  }

  try {
    await createBreadClubMagicLink(email, hashBreadClubRequestIp(request));
  } catch (error) {
    console.error("[bread-club] access email failed", error);
    return NextResponse.json(
      { error: "The secure link could not be sent. Please try again." },
      { status: 503 },
    );
  }

  return NextResponse.json({
    message:
      "If that email has an active Bread Club membership, a secure link is on the way.",
  });
}
