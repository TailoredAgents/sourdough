import { afterEach, describe, expect, it, vi } from "vitest";
import { isSameOriginMutation } from "./request-security";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("same-origin mutation checks", () => {
  it("accepts the configured site origin and rejects foreign origins", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://www.landlsourdough.com");
    expect(
      isSameOriginMutation(
        new Request("https://www.landlsourdough.com/api/test", {
          headers: { origin: "https://www.landlsourdough.com" },
        }),
      ),
    ).toBe(true);
    expect(
      isSameOriginMutation(
        new Request("https://www.landlsourdough.com/api/test", {
          headers: { origin: "https://attacker.example" },
        }),
      ),
    ).toBe(false);
  });

  it("fails closed on a missing Origin header in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://www.landlsourdough.com");
    expect(
      isSameOriginMutation(
        new Request("https://www.landlsourdough.com/api/test"),
      ),
    ).toBe(false);
  });
});
