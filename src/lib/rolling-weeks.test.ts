import { beforeEach, describe, expect, it, vi } from "vitest";
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
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
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
});
