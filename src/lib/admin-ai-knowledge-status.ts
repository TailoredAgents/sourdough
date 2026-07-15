import type { AiKnowledgeEntry } from "./types";

const allergenFreePattern =
  /\b(allergen|gluten|nut|peanut|dairy|egg|wheat)[ -]?free\b/;
const allergenSafetyPattern =
  /\b(safe for|safe with|safe if you have)\b.*\b(allerg|celiac|diabetes|pregnan)/;
const medicalClaimPattern = /\b(cure|treat|prevent|heal)\b/;
const guaranteePattern = /\b(guarantee|guaranteed|always deliver|promise delivery)\b/;

function isNegatedAllergenFreeText(text: string) {
  return (
    text.includes("does not claim") ||
    text.includes("do not claim") ||
    text.includes("not allergen-free") ||
    text.includes("cannot guarantee") ||
    text.includes("does not make allergen-free")
  );
}

export function getAiKnowledgeReviewWarnings(input: {
  approved: boolean;
  body: string;
}) {
  const body = input.body.trim();
  const lower = body.toLowerCase();
  const warnings: string[] = [];

  if (input.approved && allergenFreePattern.test(lower) && !isNegatedAllergenFreeText(lower)) {
    warnings.push("Do not approve allergen-free, gluten-free, or cross-contact claims.");
  }

  if (input.approved && allergenSafetyPattern.test(lower)) {
    warnings.push("Do not approve allergy or medical safety advice.");
  }

  if (input.approved && medicalClaimPattern.test(lower)) {
    warnings.push("Do not approve medical claims.");
  }

  if (input.approved && guaranteePattern.test(lower)) {
    warnings.push("Do not approve guarantees or delivery promises.");
  }

  if (body.length > 900) {
    warnings.push("Keep approved facts short enough for chat to use accurately.");
  }

  return warnings;
}

export function summarizeAiKnowledgeEntries(entries: AiKnowledgeEntry[]) {
  return entries.reduce(
    (summary, entry) => {
      const warnings = getAiKnowledgeReviewWarnings(entry);

      return {
        approved: summary.approved + (entry.approved ? 1 : 0),
        drafts: summary.drafts + (entry.approved ? 0 : 1),
        needsReview: summary.needsReview + (warnings.length ? 1 : 0),
      };
    },
    {
      approved: 0,
      drafts: 0,
      needsReview: 0,
    },
  );
}
