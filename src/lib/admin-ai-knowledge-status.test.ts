import { describe, expect, it } from "vitest";
import {
  getAiKnowledgeReviewWarnings,
  summarizeAiKnowledgeEntries,
} from "./admin-ai-knowledge-status";
import type { AiKnowledgeEntry } from "./types";

const entry: AiKnowledgeEntry = {
  id: "knowledge-1",
  title: "Delivery",
  body: "Delivery is available in selected Canton and Woodstock ZIP codes.",
  approved: true,
  createdAt: "2026-07-15T12:00:00.000Z",
  updatedAt: "2026-07-15T12:00:00.000Z",
};

describe("admin AI knowledge review status", () => {
  it("allows factual approved bakery information", () => {
    expect(getAiKnowledgeReviewWarnings(entry)).toEqual([]);
  });

  it("flags risky approved facts before chat can use them", () => {
    expect(
      getAiKnowledgeReviewWarnings({
        approved: true,
        body: "This loaf is gluten-free and safe for customers with celiac disease.",
      }),
    ).toEqual([
      "Do not approve allergen-free, gluten-free, or cross-contact claims.",
      "Do not approve allergy or medical safety advice.",
    ]);

    expect(
      getAiKnowledgeReviewWarnings({
        approved: true,
        body: "We guarantee delivery by noon.",
      }),
    ).toEqual(["Do not approve guarantees or delivery promises."]);
  });

  it("allows cautionary allergen wording", () => {
    expect(
      getAiKnowledgeReviewWarnings({
        approved: true,
        body: "The bakery does not claim allergen-free preparation.",
      }),
    ).toEqual([]);
  });

  it("counts approved, draft, and review-needed entries", () => {
    expect(
      summarizeAiKnowledgeEntries([
        entry,
        { ...entry, id: "knowledge-2", approved: false },
        { ...entry, id: "knowledge-3", body: "We guarantee delivery by noon." },
      ]),
    ).toEqual({
      approved: 2,
      drafts: 1,
      needsReview: 1,
    });
  });
});
