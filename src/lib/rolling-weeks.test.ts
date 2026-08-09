import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRollingDeliveryWeekSchedules } from "./bake-schedule";
import { ensureRollingWeeklyMenus } from "./rolling-weeks";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("./supabase", () => ({
  getSupabaseAdminClient: () => ({
    from: mocks.from,
    rpc: mocks.rpc,
  }),
}));

beforeEach(() => {
  mocks.from.mockReset();
  mocks.rpc.mockReset();
});

describe("rolling Sunday delivery weeks", () => {
  it("creates five Sunday delivery weeks with one Sunday slot each", async () => {
    let weeklyMenuSelectCount = 0;
    let generatedMenuCount = 0;
    mocks.rpc.mockImplementation(async () => {
      generatedMenuCount += 1;
      return { data: `menu-${generatedMenuCount}`, error: null };
    });
    mocks.from.mockImplementation((table: string) => {
      if (table === "weekly_menus") {
        return {
          select: () => {
            weeklyMenuSelectCount += 1;
            if (weeklyMenuSelectCount === 1) {
              return {
                eq: () => ({
                  order: () => ({
                    order: () => ({
                      limit: async () => ({
                        data: [
                          {
                            id: "template-menu",
                            name: "Starter Bake Drop",
                            published: true,
                            auto_generated: false,
                          },
                        ],
                        error: null,
                      }),
                    }),
                  }),
                }),
              };
            }
            return {
              eq: () => ({
                gte: () => ({
                  lte: () => ({
                    order: async () => ({ data: [], error: null }),
                  }),
                }),
              }),
            };
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    const ids = await ensureRollingWeeklyMenus(new Date("2026-07-22T14:00:00.000Z"));

    expect(ids).toEqual(["menu-1", "menu-2", "menu-3", "menu-4", "menu-5"]);
    expect(mocks.rpc).toHaveBeenCalledTimes(5);
    expect(mocks.rpc).toHaveBeenNthCalledWith(
      1,
      "ensure_atomic_rolling_week",
      expect.objectContaining({
        p_template_weekly_menu_id: "template-menu",
        p_existing_weekly_menu_id: null,
        p_order_cutoff_at: "2026-07-24T04:00:00.000Z",
        p_starts_at: "2026-07-20T04:00:00.000Z",
        p_ends_at: "2026-07-27T03:59:00.000Z",
        p_delivery_label: "Sunday, Jul 26, 3:00 PM-6:00 PM",
        p_delivery_starts_at: "2026-07-26T19:00:00.000Z",
        p_delivery_ends_at: "2026-07-26T22:00:00.000Z",
        p_delivery_capacity: 20,
      }),
    );
  });

  it("sends existing generated weeks through the idempotent repair command", async () => {
    const now = new Date("2026-07-22T14:00:00.000Z");
    const schedules = getRollingDeliveryWeekSchedules(now);
    const menuIds = schedules.map((_, index) => `menu-${index + 1}`);
    let weeklyMenuSelectCount = 0;
    mocks.rpc.mockImplementation(
      async (_name: string, values: { p_existing_weekly_menu_id: string }) => ({
        data: values.p_existing_weekly_menu_id,
        error: null,
      }),
    );

    mocks.from.mockImplementation((table: string) => {
      if (table === "weekly_menus") {
        return {
          select: () => {
            weeklyMenuSelectCount += 1;
            if (weeklyMenuSelectCount === 1) {
              return {
                eq: () => ({
                  order: () => ({
                    order: () => ({
                      limit: async () => ({
                        data: [
                          {
                            id: "template-menu",
                            name: "Starter Bake Drop",
                            published: true,
                            auto_generated: false,
                          },
                        ],
                        error: null,
                      }),
                    }),
                  }),
                }),
              };
            }
            return {
              eq: () => ({
                gte: () => ({
                  lte: () => ({
                    order: async () => ({
                      data: schedules.map((schedule, index) => ({
                        id: menuIds[index],
                        name: `Sunday ${index + 1}`,
                        order_cutoff_at: schedule.orderCutoffAt.toISOString(),
                        starts_at: schedule.startsAt.toISOString(),
                        ends_at: schedule.endsAt.toISOString(),
                        published: true,
                        auto_generated: true,
                        generation_key: `template-menu:sunday:${schedule.startsAt
                          .toISOString()
                          .slice(0, 10)}`,
                        source_weekly_menu_id: "template-menu",
                      })),
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    await expect(ensureRollingWeeklyMenus(now)).resolves.toEqual(menuIds);
    expect(mocks.rpc).toHaveBeenCalledTimes(5);
    expect(mocks.rpc).toHaveBeenNthCalledWith(
      1,
      "ensure_atomic_rolling_week",
      expect.objectContaining({
        p_template_weekly_menu_id: "template-menu",
        p_existing_weekly_menu_id: "menu-1",
      }),
    );
  });
});
