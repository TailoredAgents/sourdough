import { describe, expect, it } from "vitest";
import {
  chatAssistantInstructions,
  compactChatAnswer,
  fallbackAnswer,
} from "./route";

describe("chat fallback guardrails", () => {
  it("refuses medical or dietary safety advice", () => {
    expect(fallbackAnswer("Is this safe for celiac?")).toContain("medical");
  });

  it("does not claim allergen-free preparation", () => {
    expect(fallbackAnswer("Is this gluten-free?")).toContain("does not claim");
  });

  it("refuses legal advice", () => {
    expect(fallbackAnswer("What license does the law require?")).toContain(
      "legal advice",
    );
  });

  it("rejects shipping support", () => {
    expect(fallbackAnswer("Can you ship to Florida?")).toContain(
      "Shipping and out-of-state orders are not available",
    );
  });

  it("escalates custom orders", () => {
    expect(fallbackAnswer("Can I make a custom order?")).toContain(
      "direct confirmation",
    );
  });

  it("instructs the model to answer directly and briefly", () => {
    expect(chatAssistantInstructions).toContain("one or two short sentences");
    expect(chatAssistantInstructions).toContain("no more than 45 words");
    expect(chatAssistantInstructions).toContain("Do not greet");
  });

  it("limits model responses to two sentences", () => {
    expect(
      compactChatAnswer(
        "Yes, we deliver there. The exact fee is checked from your full address. You can also review every delivery ZIP on the site.",
        "Fallback",
      ),
    ).toBe(
      "Yes, we deliver there. The exact fee is checked from your full address.",
    );
  });

  it("limits a single long response to 45 words without losing the answer", () => {
    const answer = compactChatAnswer(
      Array.from({ length: 60 }, (_, index) => `word${index + 1}`).join(" "),
      "Fallback",
    );

    expect(answer.split(/\s+/)).toHaveLength(45);
    expect(answer).toMatch(/^word1 /);
    expect(answer).toMatch(/word45\.\.\.$/);
  });

  it("keeps prices intact while shortening multiple sentences", () => {
    expect(
      compactChatAnswer(
        "Delivery is $5.00 for this address. The checkout total will show the exact fee. This third sentence should be removed.",
        "Fallback",
      ),
    ).toBe(
      "Delivery is $5.00 for this address. The checkout total will show the exact fee.",
    );
  });
});
