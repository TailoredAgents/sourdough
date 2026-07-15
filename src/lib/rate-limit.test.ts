import { describe, expect, it } from "vitest";
import { canBypassRateLimit } from "./rate-limit";

describe("rate limit safety", () => {
  it("allows rate-limit bypass only outside production", () => {
    expect(canBypassRateLimit("development")).toBe(true);
    expect(canBypassRateLimit("test")).toBe(true);
    expect(canBypassRateLimit("production")).toBe(false);
  });
});
