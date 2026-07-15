import { describe, expect, it } from "vitest";
import {
  extractAdminDraftText,
  getAdminDraftReviewWarnings,
  getAdminDraftStats,
  isAdminDraftType,
  validateAdminDraftInput,
} from "./admin-draft";

describe("admin draft helpers", () => {
  it("validates draft type and required owner context", () => {
    expect(isAdminDraftType("weekly_announcement")).toBe(true);
    expect(isAdminDraftType("unsupported")).toBe(false);
    expect(
      validateAdminDraftInput({
        type: "weekly_announcement",
        context: "Announce this week.",
      }),
    ).toBeNull();
    expect(
      validateAdminDraftInput({
        type: "weekly_announcement",
        context: "   ",
      }),
    ).toBe("Add context before generating a draft.");
  });

  it("extracts only usable generated draft text from API payloads", () => {
    expect(extractAdminDraftText({ draft: "Ready to review." })).toBe(
      "Ready to review.",
    );
    expect(extractAdminDraftText({ draft: "" })).toBeNull();
    expect(extractAdminDraftText({ error: "No draft" })).toBeNull();
    expect(extractAdminDraftText(null)).toBeNull();
  });

  it("summarizes draft length for owner review", () => {
    expect(getAdminDraftStats("Fresh bread is ready.")).toEqual({
      characters: 21,
      words: 4,
    });
  });

  it("flags draft wording that needs owner review before copying", () => {
    expect(
      getAdminDraftReviewWarnings(
        "This gluten-free loaf was sent and we guarantee delivery.",
      ),
    ).toEqual([
      "Remove wording that implies this draft has already been sent or published.",
      "Remove allergen-free or cross-contact claims before using this draft.",
      "Remove guarantees or delivery promises before using this draft.",
    ]);
    expect(getAdminDraftReviewWarnings("Fresh sourdough is available this week.")).toEqual(
      [],
    );
    expect(getAdminDraftReviewWarnings("Mention the posted order cutoff.")).toEqual([]);
  });
});
