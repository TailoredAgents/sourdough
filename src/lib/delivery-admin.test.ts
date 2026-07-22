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
    serviceAreaCopy: "Delivery is available in selected local ZIP codes.",
  },
  windows: [
    {
      label: "Sunday, Jul 19, 3:00 PM-6:00 PM",
      startsAt: "2026-07-19T19:00:00.000Z",
      endsAt: "2026-07-19T22:00:00.000Z",
      capacity: 20,
      reserved: 4,
      remove: false,
    },
  ],
};

describe("delivery admin validation", () => {
  it("accepts valid delivery settings and windows", () => {
    expect(deliveryAdminSchema.safeParse(validPayload).success).toBe(true);
  });

  it("rejects invalid Sunday delivery dates", () => {
    expect(
      deliveryAdminSchema.safeParse({
        ...validPayload,
        windows: [{ ...validPayload.windows[0], startsAt: "not-a-date" }],
      }).success,
    ).toBe(false);
  });

  it("rejects Sunday delivery slots that end before they start", () => {
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

  it("rejects more than one active Sunday delivery slot", () => {
    expect(
      deliveryAdminSchema.safeParse({
        ...validPayload,
        windows: [
          validPayload.windows[0],
          {
            ...validPayload.windows[0],
            label: "Extra Sunday slot",
            startsAt: "2026-07-19T22:00:00.000Z",
            endsAt: "2026-07-20T00:00:00.000Z",
            reserved: 0,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects removing windows that still have reserved orders", () => {
    expect(
      deliveryAdminSchema.safeParse({
        ...validPayload,
        windows: [{ ...validPayload.windows[0], remove: true }],
      }).success,
    ).toBe(false);
  });
});
