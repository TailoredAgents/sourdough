import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatSundayDeliveryWindowLabel,
  getRollingDeliveryWeekSchedules,
} from "./bake-schedule";
import { ensureRollingWeeklyMenus } from "./rolling-weeks";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  insertedMenus: [] as unknown[],
  insertedWindows: [] as unknown[],
}));

vi.mock("./supabase", () => ({
  getSupabaseAdminClient: () => ({
    from: mocks.from,
  }),
}));

beforeEach(() => {
  mocks.from.mockReset();
  mocks.insertedMenus.length = 0;
  mocks.insertedWindows.length = 0;
});

describe("rolling Sunday delivery weeks", () => {
  it("creates five Sunday delivery weeks with one Sunday slot each", async () => {
    let weeklyMenuSelectCount = 0;
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
          insert: (payload: unknown) => {
            mocks.insertedMenus.push(payload);
            return {
              select: () => ({
                single: async () => ({
                  data: { id: `menu-${mocks.insertedMenus.length}` },
                  error: null,
                }),
              }),
            };
          },
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }

      if (table === "weekly_menu_items") {
        return {
          select: () => ({
            eq: async () => ({
              data: [
                {
                  product_id: "product-1",
                  available_quantity: 10,
                  sold_quantity: 4,
                  featured: true,
                  unavailable: false,
                },
              ],
              error: null,
            }),
          }),
          insert: async () => ({ error: null }),
        };
      }

      if (table === "delivery_windows") {
        return {
          select: () => ({
            in: () => ({
              order: async () => ({ data: [], error: null }),
            }),
          }),
          insert: async (payload: unknown) => {
            mocks.insertedWindows.push(payload);
            return { error: null };
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    const ids = await ensureRollingWeeklyMenus(new Date("2026-07-22T14:00:00.000Z"));

    expect(ids).toEqual(["menu-1", "menu-2", "menu-3", "menu-4", "menu-5"]);
    expect(mocks.insertedMenus).toHaveLength(5);
    expect(mocks.insertedMenus[0]).toMatchObject({
      order_cutoff_at: "2026-07-24T04:00:00.000Z",
      starts_at: "2026-07-20T04:00:00.000Z",
      ends_at: "2026-07-27T03:59:00.000Z",
      published: true,
      auto_generated: true,
    });
    expect(mocks.insertedWindows).toHaveLength(5);
    expect(mocks.insertedWindows[0]).toMatchObject({
      weekly_menu_id: "menu-1",
      label: "Sunday, Jul 26, 3:00 PM-6:00 PM",
      starts_at: "2026-07-26T19:00:00.000Z",
      ends_at: "2026-07-26T22:00:00.000Z",
      capacity: 20,
      reserved: 0,
    });
  });

  it("does not rewrite existing Sunday windows or reread template items", async () => {
    const now = new Date("2026-07-22T14:00:00.000Z");
    const schedules = getRollingDeliveryWeekSchedules(now);
    const menuIds = schedules.map((_, index) => `menu-${index + 1}`);
    let weeklyMenuSelectCount = 0;
    let templateItemReads = 0;
    let menuUpdates = 0;
    let windowUpdates = 0;

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
                      })),
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          },
          update: () => {
            menuUpdates += 1;
            return { eq: async () => ({ error: null }) };
          },
        };
      }

      if (table === "weekly_menu_items") {
        templateItemReads += 1;
        throw new Error("Template items should not be read for complete weeks.");
      }

      if (table === "delivery_windows") {
        return {
          select: () => ({
            in: () => ({
              order: async () => ({
                data: schedules.map((schedule, index) => ({
                  id: `window-${index + 1}`,
                  weekly_menu_id: menuIds[index],
                  label: formatSundayDeliveryWindowLabel(
                    schedule.deliveryStartsAt,
                    schedule.deliveryEndsAt,
                  ),
                  starts_at: schedule.deliveryStartsAt.toISOString(),
                  ends_at: schedule.deliveryEndsAt.toISOString(),
                  capacity: 20,
                  reserved: 0,
                })),
                error: null,
              }),
            }),
          }),
          update: () => {
            windowUpdates += 1;
            return { eq: async () => ({ error: null }) };
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    await expect(ensureRollingWeeklyMenus(now)).resolves.toEqual(menuIds);
    expect(templateItemReads).toBe(0);
    expect(menuUpdates).toBe(0);
    expect(windowUpdates).toBe(0);
  });
});
