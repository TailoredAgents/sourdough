import { describe, expect, it } from "vitest";
import { deliveryAdminSchema } from "./delivery-admin";

const validPayload = {
  weeklyMenuId: "00000000-0000-4000-8000-000000000100",
  settings: {
    centerLat: 34.2368,
    centerLng: -84.4908,
    radiusMiles: 12,
    deliveryFeeCents: 600,
    allowedPostalCodes: ["30114", "30115"],
    serviceAreaCopy: "Delivery is available in selected Canton-area ZIP codes.",
  },
  windows: [
    {
      label: "Wednesday afternoon",
      startsAt: "2026-07-15T19:00:00.000Z",
      endsAt: "2026-07-15T22:00:00.000Z",
      capacity: 12,
      reserved: 4,
      remove: false,
    },
  ],
};

describe("delivery admin validation", () => {
  it("accepts valid delivery settings and windows", () => {
    expect(deliveryAdminSchema.safeParse(validPayload).success).toBe(true);
  });

  it("rejects invalid delivery window dates", () => {
    expect(
      deliveryAdminSchema.safeParse({
        ...validPayload,
        windows: [{ ...validPayload.windows[0], startsAt: "not-a-date" }],
      }).success,
    ).toBe(false);
  });

  it("rejects delivery windows that end before they start", () => {
    expect(
      deliveryAdminSchema.safeParse({
        ...validPayload,
        windows: [
          {
            ...validPayload.windows[0],
            endsAt: "2026-07-15T18:00:00.000Z",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects reserved spots above capacity", () => {
    expect(
      deliveryAdminSchema.safeParse({
        ...validPayload,
        windows: [{ ...validPayload.windows[0], capacity: 2, reserved: 3 }],
      }).success,
    ).toBe(false);
  });
});
