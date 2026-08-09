import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("./supabase", () => ({
  getSupabaseAdminClient: () => ({ rpc: mocks.rpc }),
}));

import {
  canBypassRateLimit,
  checkRateLimitChain,
  getRequestClientIp,
} from "./rate-limit";

beforeEach(() => {
  mocks.rpc.mockReset();
});

describe("rate limit safety", () => {
  it("allows rate-limit bypass only outside production", () => {
    expect(canBypassRateLimit("development")).toBe(true);
    expect(canBypassRateLimit("test")).toBe(true);
    expect(canBypassRateLimit("production")).toBe(false);
  });

  it("uses Render's appended peer instead of a spoofable first address", () => {
    const request = new Request("https://example.com", {
      headers: {
        "x-forwarded-for": "203.0.113.10, 198.51.100.2",
      },
    });
    expect(getRequestClientIp(request, "origin-secret")).toBe("198.51.100.2");
    expect(getRequestClientIp(new Request("https://example.com"))).toBe(
      "unknown-ip",
    );
  });

  it("trusts Cloudflare's visitor IP only with the configured origin secret", () => {
    const trustedRequest = new Request("https://example.com", {
      headers: {
        "cf-connecting-ip": "203.0.113.10",
        "x-forwarded-for": "192.0.2.44, 198.51.100.2",
        "x-landl-origin-verify": "origin-secret",
      },
    });
    expect(getRequestClientIp(trustedRequest, "origin-secret")).toBe(
      "203.0.113.10",
    );

    const directSpoof = new Request("https://example.onrender.com", {
      headers: {
        "cf-connecting-ip": "192.0.2.99",
        "x-forwarded-for": "192.0.2.99, 198.51.100.8",
        "x-landl-origin-verify": "wrong-secret",
      },
    });
    expect(getRequestClientIp(directSpoof, "origin-secret")).toBe(
      "198.51.100.8",
    );
  });

  it("does not create identity buckets after the coarse IP bucket denies", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [{ allowed: false, remaining: 0 }],
      error: null,
    });

    await expect(
      checkRateLimitChain(
        {
          scope: "checkout_ip",
          key: "203.0.113.8",
          limit: 20,
          windowMs: 60_000,
        },
        {
          scope: "checkout_identity",
          key: "203.0.113.8:many-addresses@example.com",
          limit: 5,
          windowMs: 60_000,
        },
      ),
    ).resolves.toEqual({ allowed: false, remaining: 0 });

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "consume_rate_limit",
      expect.objectContaining({ p_scope: "checkout_ip" }),
    );
  });

  it("checks the finer identity bucket only after the IP bucket allows", async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: [{ allowed: true, remaining: 19 }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ allowed: false, remaining: 0 }],
        error: null,
      });

    const result = await checkRateLimitChain(
      {
        scope: "checkout_ip",
        key: "203.0.113.8",
        limit: 20,
        windowMs: 60_000,
      },
      {
        scope: "checkout_identity",
        key: "203.0.113.8:customer@example.com",
        limit: 5,
        windowMs: 60_000,
      },
    );

    expect(result).toEqual({ allowed: false, remaining: 0 });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.mock.calls.map((call) => call[1].p_scope)).toEqual([
      "checkout_ip",
      "checkout_identity",
    ]);
  });
});
