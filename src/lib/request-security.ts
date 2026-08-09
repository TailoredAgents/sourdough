import { getSiteUrl } from "./utils";
import { NextResponse } from "next/server";

export function isSameOriginMutation(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";

  try {
    return new URL(origin).origin === new URL(getSiteUrl()).origin;
  } catch {
    return false;
  }
}

/**
 * Use at the start of cookie-authenticated mutation handlers. Returning a
 * response keeps every caller's failure mode consistent and, in production,
 * fails closed when browsers omit Origin.
 */
export function rejectCrossOriginMutation(request: Request) {
  return isSameOriginMutation(request)
    ? null
    : NextResponse.json(
        { error: "This action must be requested from the bakery site." },
        { status: 403 },
      );
}
