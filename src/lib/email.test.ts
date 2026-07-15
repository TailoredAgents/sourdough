import { describe, expect, it } from "vitest";
import { getMissingResendEmailError } from "./email";

describe("email configuration safety", () => {
  it("allows demo email only outside production", () => {
    expect(getMissingResendEmailError("development")).toBeNull();
    expect(getMissingResendEmailError("test")).toBeNull();
    expect(getMissingResendEmailError("production")).toContain(
      "Email delivery is not configured",
    );
  });
});
