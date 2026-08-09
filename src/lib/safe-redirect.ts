export function getSafeLocalRedirectUrl(
  destination: string | null,
  siteUrl: string,
  fallbackPath = "/",
) {
  const site = new URL(siteUrl);
  if (!destination) return new URL(fallbackPath, site);

  try {
    const candidate = new URL(destination, site);
    return candidate.origin === site.origin
      ? candidate
      : new URL(fallbackPath, site);
  } catch {
    return new URL(fallbackPath, site);
  }
}
