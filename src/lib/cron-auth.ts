import { timingSafeEqual } from "crypto";

function isBearerRequestAuthorized(request: Request, secret: string | undefined) {
  const authorization = request.headers.get("authorization");
  if (!secret || !authorization?.startsWith("Bearer ")) return false;
  const supplied = authorization.slice("Bearer ".length);
  const expectedBuffer = Buffer.from(secret);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

export function isCronRequestAuthorized(request: Request) {
  return isBearerRequestAuthorized(request, process.env.CRON_SECRET);
}

export function isBreadClubSetupRequestAuthorized(request: Request) {
  return isBearerRequestAuthorized(
    request,
    process.env.BREAD_CLUB_SETUP_SECRET,
  );
}
