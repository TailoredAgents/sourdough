export async function readAdminJsonResponse(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

export function getAdminPayloadError(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const error = (payload as { error?: unknown }).error;
  return typeof error === "string" && error.trim() ? error : null;
}

export function hasAdminKeys<T extends string>(
  payload: unknown,
  keys: T[],
): payload is Record<T, unknown> {
  if (!payload || typeof payload !== "object") return false;
  return keys.every((key) => key in payload);
}
