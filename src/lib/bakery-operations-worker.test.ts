import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../../workers/bakery-operations";

const controller = { scheduledTime: 0, cron: "7 * * * *" } as ScheduledController;

function environment(response: Response) {
  const fetch = vi.fn().mockResolvedValue(response);
  return {
    fetch,
    env: { CRON_SECRET: "test-only", STOREFRONT: { fetch } } as unknown as BakeryCronEnv,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("hourly bakery operations Worker", () => {
  it("authenticates the service binding request and waits for completion", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { env, fetch } = environment(Response.json({ ok: true }));
    await worker.scheduled(controller, env);
    const request = fetch.mock.calls[0][0] as Request;
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe("/api/cron/bread-club");
    expect(request.headers.get("authorization")).toBe("Bearer test-only");
  });

  it.each([
    new Response("bad gateway", { status: 502 }),
    Response.json({ ok: true }, { status: 500 }),
    Response.json({ ok: false }),
    new Response("not JSON"),
  ])("reports unsuccessful operations as failed scheduled events", async (response) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { env } = environment(response);
    await expect(worker.scheduled(controller, env)).rejects.toThrow("Bakery operations failed");
  });

  it("does not call the storefront without a configured secret", async () => {
    const { env, fetch } = environment(Response.json({ ok: true }));
    env.CRON_SECRET = "";
    await expect(worker.scheduled(controller, env)).rejects.toThrow("not configured");
    expect(fetch).not.toHaveBeenCalled();
  });
});
