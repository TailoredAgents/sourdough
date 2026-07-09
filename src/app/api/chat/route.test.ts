import { describe, expect, it } from "vitest";
import { fallbackAnswer } from "./route";

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
      "direct bakery confirmation",
    );
  });
});
