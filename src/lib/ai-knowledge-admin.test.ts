import { describe, expect, it } from "vitest";
import { aiKnowledgeAdminSchema } from "./ai-knowledge-admin";

const validEntry = {
  title: "Delivery area",
  body: "Delivery is available in selected Canton and Woodstock ZIP codes.",
  approved: true,
};

describe("AI knowledge admin validation", () => {
  it("accepts factual approved entries", () => {
    expect(aiKnowledgeAdminSchema.safeParse(validEntry).success).toBe(true);
  });

  it("rejects risky claims when approved for customer chat", () => {
    expect(
      aiKnowledgeAdminSchema.safeParse({
        ...validEntry,
        title: "Allergen claim",
        body: "This loaf is gluten-free and safe for customers with allergies.",
      }).success,
    ).toBe(false);
  });

  it("allows risky wording to be saved as an unapproved draft for review", () => {
    expect(
      aiKnowledgeAdminSchema.safeParse({
        ...validEntry,
        title: "Draft allergen note",
        body: "This loaf is gluten-free and needs owner review.",
        approved: false,
      }).success,
    ).toBe(true);
  });
});
