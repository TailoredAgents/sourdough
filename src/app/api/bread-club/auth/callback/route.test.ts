import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeBreadClubMagicLink: vi.fn(),
}));

vi.mock("@/lib/bread-club/auth", () => ({
  consumeBreadClubMagicLink: mocks.consumeBreadClubMagicLink,
}));

vi.mock("@/lib/utils", () => ({
  getSiteUrl: () => "https://www.landlsourdough.com",
}));

import { GET, POST } from "./route";

const token = "A".repeat(43);

function formRequest(value: string, origin = "https://www.landlsourdough.com") {
  return new Request(
    "https://www.landlsourdough.com/api/bread-club/auth/callback",
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin,
      },
      body: new URLSearchParams({ token: value }),
    },
  );
}

beforeEach(() => {
  mocks.consumeBreadClubMagicLink.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Bread Club magic-link callback", () => {
  it("does not consume a token when an email scanner follows the GET link", async () => {
    const response = await GET(
      new Request(
        `https://www.landlsourdough.com/api/bread-club/auth/callback?token=${token}`,
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `https://www.landlsourdough.com/bread-club/auth/confirm?token=${token}`,
    );
    expect(mocks.consumeBreadClubMagicLink).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin confirmation before consuming the token", async () => {
    const response = await POST(formRequest(token, "https://attacker.example"));

    expect(response.status).toBe(403);
    expect(mocks.consumeBreadClubMagicLink).not.toHaveBeenCalled();
  });

  it("uses a 303 redirect when an exchanged token is expired", async () => {
    mocks.consumeBreadClubMagicLink.mockResolvedValue(null);

    const response = await POST(formRequest(token));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://www.landlsourdough.com/bread-club/manage?access=expired",
    );
    expect(mocks.consumeBreadClubMagicLink).toHaveBeenCalledWith(token);
  });

  it("sets the session cookie only after an atomic successful exchange", async () => {
    mocks.consumeBreadClubMagicLink.mockResolvedValue({
      rawSession: "session-token",
      membershipId: "11111111-1111-4111-8111-111111111111",
      expiresAt: new Date("2026-09-01T00:00:00.000Z"),
    });

    const response = await POST(formRequest(token));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://www.landlsourdough.com/bread-club/manage",
    );
    expect(response.headers.get("set-cookie")).toContain("session-token");
  });
});
