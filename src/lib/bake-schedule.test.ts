import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUNDAY_DELIVERY_CAPACITY,
  formatSundayDeliveryDateLabel,
  formatSundayDeliveryWindowLabel,
  getFirstVisibleDeliveryWeekSchedule,
  getRollingDeliveryWeekSchedules,
  isStandardSundayDeliveryWindow,
} from "./bake-schedule";

describe("Sunday bake schedule", () => {
  it("maps Thursday 11:59 PM Eastern to the Friday midnight cutoff", () => {
    const schedule = getFirstVisibleDeliveryWeekSchedule(
      new Date("2026-07-22T14:00:00.000Z"),
    );

    expect(schedule.startsAt.toISOString()).toBe("2026-07-20T04:00:00.000Z");
    expect(schedule.orderCutoffAt.toISOString()).toBe("2026-07-24T04:00:00.000Z");
    expect(schedule.deliveryStartsAt.toISOString()).toBe("2026-07-26T19:00:00.000Z");
    expect(schedule.deliveryEndsAt.toISOString()).toBe("2026-07-26T22:00:00.000Z");
  });

  it("keeps the current Sunday visible until 6 PM Eastern, then moves to next week", () => {
    expect(
      getFirstVisibleDeliveryWeekSchedule(
        new Date("2026-07-26T21:59:59.000Z"),
      ).deliveryStartsAt.toISOString(),
    ).toBe("2026-07-26T19:00:00.000Z");
    expect(
      getFirstVisibleDeliveryWeekSchedule(
        new Date("2026-07-26T22:00:00.000Z"),
      ).deliveryStartsAt.toISOString(),
    ).toBe("2026-08-02T19:00:00.000Z");
  });

  it("generates five Sunday delivery weeks", () => {
    const weeks = getRollingDeliveryWeekSchedules(
      new Date("2026-07-22T14:00:00.000Z"),
    );

    expect(weeks).toHaveLength(5);
    expect(weeks.map((week) => formatSundayDeliveryDateLabel(week.deliveryStartsAt))).toEqual([
      "Sunday, July 26 delivery",
      "Sunday, August 2 delivery",
      "Sunday, August 9 delivery",
      "Sunday, August 16 delivery",
      "Sunday, August 23 delivery",
    ]);
    expect(
      weeks.map((week) =>
        formatSundayDeliveryWindowLabel(week.deliveryStartsAt, week.deliveryEndsAt),
      ),
    ).toEqual([
      "Sunday, Jul 26, 3:00 PM-6:00 PM",
      "Sunday, Aug 2, 3:00 PM-6:00 PM",
      "Sunday, Aug 9, 3:00 PM-6:00 PM",
      "Sunday, Aug 16, 3:00 PM-6:00 PM",
      "Sunday, Aug 23, 3:00 PM-6:00 PM",
    ]);
    expect(DEFAULT_SUNDAY_DELIVERY_CAPACITY).toBe(20);
  });

  it("identifies the standard Sunday 3-6 PM delivery window", () => {
    expect(
      isStandardSundayDeliveryWindow(
        "2026-07-26T19:00:00.000Z",
        "2026-07-26T22:00:00.000Z",
      ),
    ).toBe(true);
    expect(
      isStandardSundayDeliveryWindow(
        "2026-07-24T19:00:00.000Z",
        "2026-07-24T22:00:00.000Z",
      ),
    ).toBe(false);
  });
});
