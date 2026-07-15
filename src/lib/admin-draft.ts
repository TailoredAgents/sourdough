export const adminDraftTypes = [
  "weekly_announcement",
  "product_description",
  "customer_reply",
  "order_summary",
] as const;

export type AdminDraftType = (typeof adminDraftTypes)[number];

export function isAdminDraftType(value: string): value is AdminDraftType {
  return adminDraftTypes.includes(value as AdminDraftType);
}

export function validateAdminDraftInput({
  context,
  type,
}: {
  context: string;
  type: string;
}) {
  if (!isAdminDraftType(type)) return "Choose a valid draft type.";
  if (!context.trim()) return "Add context before generating a draft.";
  if (context.length > 2000) return "Draft context must stay under 2000 characters.";
  return null;
}

export function extractAdminDraftText(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const draft = (payload as { draft?: unknown }).draft;
  return typeof draft === "string" && draft.trim() ? draft : null;
}

export function getAdminDraftStats(draft: string) {
  const trimmed = draft.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;

  return {
    characters: draft.length,
    words,
  };
}

export function getAdminDraftReviewWarnings(draft: string) {
  const lower = draft.toLowerCase();
  const warnings: string[] = [];

  if (!draft.trim()) return warnings;

  if (
    /\b(sent|published|emailed)\b/.test(lower) ||
    /\b(has been|already|we) posted\b/.test(lower)
  ) {
    warnings.push("Remove wording that implies this draft has already been sent or published.");
  }

  if (/\b(allergen|gluten|nut|peanut|dairy|egg|wheat)[ -]?free\b/.test(lower)) {
    warnings.push("Remove allergen-free or cross-contact claims before using this draft.");
  }

  if (/\b(guarantee|guaranteed|promise delivery|always deliver)\b/.test(lower)) {
    warnings.push("Remove guarantees or delivery promises before using this draft.");
  }

  if (draft.length > 1200) {
    warnings.push("Shorten this draft before sending so customers can scan it quickly.");
  }

  return warnings;
}
