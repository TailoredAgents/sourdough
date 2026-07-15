import type { DeliveryAddress } from "./types";

export function buildMailtoHref(
  email: string | null | undefined,
  subject?: string | null,
) {
  const trimmedEmail = email?.trim();
  if (!trimmedEmail) return null;

  const trimmedSubject = subject?.trim();
  if (!trimmedSubject) return `mailto:${trimmedEmail}`;

  return `mailto:${trimmedEmail}?subject=${encodeURIComponent(trimmedSubject)}`;
}

export function buildTelHref(phone: string | null | undefined) {
  const digits = phone?.replace(/\D/g, "") ?? "";
  if (digits.length < 7) return null;

  if (digits.length === 10) return `tel:+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `tel:+${digits}`;

  return `tel:${digits}`;
}

export function formatDeliveryAddress(address: DeliveryAddress) {
  return [
    address.line1,
    address.line2,
    `${address.city}, ${address.state} ${address.postalCode}`.trim(),
  ]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(", ");
}

export function buildMapSearchHref(address: DeliveryAddress | string | null | undefined) {
  const formattedAddress =
    typeof address === "string" ? address.trim() : address ? formatDeliveryAddress(address) : "";

  if (!formattedAddress) return null;

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    formattedAddress,
  )}`;
}
