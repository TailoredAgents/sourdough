import { describe, expect, it } from "vitest";
import { fallbackDraft } from "./route";

describe("admin draft fallback", () => {
  it("keeps weekly announcement fallback usable without a fixed cutoff claim", () => {
    const draft = fallbackDraft("weekly_announcement", "Classic country is featured.");

    expect(draft).toContain("Classic country is featured.");
    expect(draft).toContain("Review the current weekly menu cutoff");
    expect(draft).not.toContain("Thursday at 8:00 PM");
  });
});
