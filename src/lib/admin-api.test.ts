import { describe, expect, it } from "vitest";
import {
  getAdminPayloadError,
  hasAdminKeys,
  readAdminJsonResponse,
} from "./admin-api";

describe("admin API helpers", () => {
  it("reads JSON responses and tolerates malformed bodies", async () => {
    await expect(
      readAdminJsonResponse(
        new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ).resolves.toEqual({ ok: true });

    await expect(readAdminJsonResponse(new Response("not-json"))).resolves.toBeNull();
  });

  it("extracts useful admin error messages", () => {
    expect(getAdminPayloadError({ error: "Delivery failed." })).toBe(
      "Delivery failed.",
    );
    expect(getAdminPayloadError({ error: "" })).toBeNull();
    expect(getAdminPayloadError(null)).toBeNull();
  });

  it("checks expected payload keys", () => {
    expect(hasAdminKeys({ deliverySettings: {}, deliveryWindows: [] }, [
      "deliverySettings",
      "deliveryWindows",
    ])).toBe(true);
    expect(hasAdminKeys({ deliverySettings: {} }, [
      "deliverySettings",
      "deliveryWindows",
    ])).toBe(false);
  });
});
