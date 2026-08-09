import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }),
}));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  vi.stubEnv("CRON_SECRET", "a-strong-operational-health-secret");
  mocks.from.mockReset();
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: "20260808140000", error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("health route", () => {
  it("keeps the load-balancer health check shallow", async () => {
    const response = await GET(
      new Request("https://www.landlsourdough.com/api/health"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      database: "configured",
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated deep database probes", async () => {
    const response = await GET(
      new Request("https://www.landlsourdough.com/api/health?deep=1"),
    );

    expect(response.status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("runs the deep database probe with the cron bearer secret", async () => {
    const response = await GET(
      new Request("https://www.landlsourdough.com/api/health?deep=1", {
        headers: {
          authorization: "Bearer a-strong-operational-health-secret",
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      database: "reachable",
      schemaVersion: "20260808140000",
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "operational_schema_healthcheck",
    );
  });

  it("fails deep health when required migrations are missing", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "function does not exist" },
    });
    const response = await GET(
      new Request("https://www.landlsourdough.com/api/health?deep=1", {
        headers: {
          authorization: "Bearer a-strong-operational-health-secret",
        },
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      database: "unavailable_or_outdated",
    });
  });

  it("fails deep health when the database is on the previous schema version", async () => {
    mocks.rpc.mockResolvedValue({ data: "20260808124500", error: null });
    const response = await GET(
      new Request("https://www.landlsourdough.com/api/health?deep=1", {
        headers: {
          authorization: "Bearer a-strong-operational-health-secret",
        },
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      database: "unavailable_or_outdated",
    });
  });
});
