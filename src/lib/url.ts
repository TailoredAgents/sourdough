import { bakery } from "./bakery-data";

const defaultSiteUrl = `https://${bakery.domain}`;

export function absoluteUrl(pathOrUrl: string | null | undefined, siteUrl = defaultSiteUrl) {
  if (!pathOrUrl) return siteUrl;

  try {
    return new URL(pathOrUrl, siteUrl).toString();
  } catch {
    return siteUrl;
  }
}

export function absoluteImageUrl(
  imageUrl: string | null | undefined,
  fallbackPath = "/images/sourdough-hero.jpg",
  siteUrl = defaultSiteUrl,
) {
  return absoluteUrl(imageUrl || fallbackPath, siteUrl);
}
