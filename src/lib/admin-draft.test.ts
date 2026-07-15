import { describe, expect, it } from "vitest";
import {
  extractAdminDraftText,
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
});
