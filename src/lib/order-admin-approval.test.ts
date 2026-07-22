import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptApprovalOrder,
  denyApprovalOrderWithRefund,
  moveApprovalOrderToNextWeek,
} from "./order-admin";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  sendOrderStatusUpdate: vi.fn(),
  retrieveSession: vi.fn(),
  createRefund: vi.fn(),
  updates: [] as unknown[],
  rpcCalls: [] as Array<{ name: string; params: unknown }>,
}));

vi.mock("./supabase", () => ({
  getSupabaseAdminClient: () => ({
    from: mocks.from,
    rpc: mocks.rpc,
  }),
}));

vi.mock("./email", () => ({
  sendOrderStatusUpdate: mocks.sendOrderStatusUpdate,
}));

vi.mock("./stripe", () => ({
  getStripe: () => ({
    checkout: {
      sessions: {
        retrieve: mocks.retrieveSession,
      },
    },
    refunds: {
      create: mocks.createRefund,
    },
  }),
}));

const orderId = "11111111-1111-4111-8111-111111111111";
const currentWindowId = "22222222-2222-4222-8222-222222222222";
const nextWindowId = "33333333-3333-4333-8333-333333333333";

const adminOrderRow = {
  id: orderId,
  customers: {
    name: "Same Week Customer",
    email: "customer@example.com",
    phone: "4045550100",
  },
  delivery_windows: {
      label: "Sunday, Jul 26, 3:00 PM-6:00 PM",
    weekly_menu_id: "44444444-4444-4444-8444-444444444444",
    weekly_menus: {
      name: "Launch Week Bake Drop",
      starts_at: "2026-07-22T12:00:00.000Z",
    },
  },
  status: "paid",
  stripe_checkout_session_id: "cs_approval",
  subtotal_cents: 2400,
  delivery_fee_cents: 600,
  total_cents: 3000,
  delivery_address: {
    line1: "123 Main Street",
    city: "Canton",
    state: "GA",
    postalCode: "30114",
    email: "customer@example.com",
    phone: "4045550100",
  },
  delivery_miles: 4.2,
  delivery_instructions: "Leave by the front door.",
  delivery_check: null,
  notes: "Please slice if possible.",
  next_week_ok: true,
  approval_mode: "after_cutoff",
  approved_at: null,
  denied_at: null,
  refunded_at: null,
  stripe_refund_id: null,
  admin_decision_note: null,
  paid_at: "2026-07-22T14:00:00.000Z",
  created_at: "2026-07-22T14:00:00.000Z",
  updated_at: "2026-07-22T14:00:00.000Z",
  checkout_cancel_token: "cancel-token",
};

const orderItemRows = [
  {
    id: "55555555-5555-4555-8555-555555555555",
    order_id: orderId,
    product_id: "66666666-6666-4666-8666-666666666666",
    quantity: 2,
    unit_price_cents: 1200,
    products: { name: "Classic Country Loaf" },
  },
];

function setupRpcMock() {
  mocks.rpc.mockImplementation(async (name: string, params: unknown) => {
    mocks.rpcCalls.push({ name, params });
    return { error: null };
  });
}

function adminOrdersResult(status = "paid") {
  return {
    ...adminOrderRow,
    status,
    admin_decision_note:
      status === "canceled"
        ? "Denied approval request and refunded payment."
        : adminOrderRow.admin_decision_note,
  };
}

beforeEach(() => {
  mocks.from.mockReset();
  mocks.rpc.mockReset();
  mocks.sendOrderStatusUpdate.mockReset();
  mocks.retrieveSession.mockReset();
  mocks.createRefund.mockReset();
  mocks.updates.length = 0;
  mocks.rpcCalls.length = 0;
  setupRpcMock();
});

describe("admin approval request decisions", () => {
  it("accepts a paid same-week request by reserving the requested window", async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === "orders") {
        return {
          select: (columns: string) => {
            if (columns === "id, status, delivery_window_id") {
              return {
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: orderId,
                      status: "pending_approval",
                      delivery_window_id: currentWindowId,
                    },
                    error: null,
                  }),
                }),
              };
            }
            return {
              order: () => ({
                limit: async () => ({ data: [adminOrdersResult("paid")], error: null }),
              }),
            };
          },
          update: (payload: unknown) => {
            mocks.updates.push(payload);
            return {
              eq: async () => ({ error: null }),
            };
          },
        };
      }

      if (table === "order_items") {
        return {
          select: (columns: string) => {
            if (columns.startsWith("product_id")) {
              return {
                eq: async () => ({
                  data: orderItemRows.map((item) => ({
                    product_id: item.product_id,
                    quantity: item.quantity,
                  })),
                  error: null,
                }),
              };
            }
            return {
              in: () => ({
                order: async () => ({ data: orderItemRows, error: null }),
              }),
            };
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    await acceptApprovalOrder(orderId);

    expect(mocks.rpcCalls).toEqual([
      {
        name: "reserve_order_inventory",
        params: {
          p_delivery_window_id: currentWindowId,
          p_items: [
            {
              product_id: orderItemRows[0].product_id,
              quantity: 2,
            },
          ],
        },
      },
    ]);
    expect(mocks.updates[0]).toMatchObject({
      status: "paid",
      admin_decision_note: "Accepted same-week approval request.",
    });
    expect(mocks.sendOrderStatusUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "customer@example.com",
        statusLabel: "Payment confirmed",
        orderSummary: "2 x Classic Country Loaf",
      }),
    );
  });

  it("moves a paid request to a later delivery week only when customer approved fallback", async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === "orders") {
        return {
          select: (columns: string) => {
            if (
              columns ===
              "id, status, next_week_ok, delivery_windows(weekly_menus(starts_at))"
            ) {
              return {
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: orderId,
                      status: "pending_approval",
                      next_week_ok: true,
                      delivery_windows: {
                        weekly_menus: { starts_at: "2026-07-22T12:00:00.000Z" },
                      },
                    },
                    error: null,
                  }),
                }),
              };
            }
            return {
              order: () => ({
                limit: async () => ({ data: [adminOrdersResult("paid")], error: null }),
              }),
            };
          },
          update: (payload: unknown) => {
            mocks.updates.push(payload);
            return {
              eq: async () => ({ error: null }),
            };
          },
        };
      }

      if (table === "delivery_windows") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: nextWindowId,
                  starts_at: "2026-08-02T19:00:00.000Z",
                  ends_at: "2026-08-02T22:00:00.000Z",
                  weekly_menus: { starts_at: "2026-07-29T12:00:00.000Z" },
                },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "order_items") {
        return {
          select: (columns: string) =>
            columns.startsWith("product_id")
              ? {
                  eq: async () => ({
                    data: orderItemRows.map((item) => ({
                      product_id: item.product_id,
                      quantity: item.quantity,
                    })),
                    error: null,
                  }),
                }
              : {
                  in: () => ({
                    order: async () => ({ data: orderItemRows, error: null }),
                  }),
                },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    await moveApprovalOrderToNextWeek(orderId, nextWindowId);

    expect(mocks.rpcCalls[0]).toEqual({
      name: "reserve_order_inventory",
      params: {
        p_delivery_window_id: nextWindowId,
        p_items: [
          {
            product_id: orderItemRows[0].product_id,
            quantity: 2,
          },
        ],
      },
    });
    expect(mocks.updates[0]).toMatchObject({
      delivery_window_id: nextWindowId,
      status: "paid",
      admin_decision_note: "Moved approval request to next delivery week.",
    });
  });

  it("denies and refunds a paid same-week request through Stripe", async () => {
    mocks.retrieveSession.mockResolvedValue({ payment_intent: "pi_approval" });
    mocks.createRefund.mockResolvedValue({ id: "re_approval" });
    mocks.from.mockImplementation((table: string) => {
      if (table === "orders") {
        return {
          select: (columns: string) => {
            if (columns === "id, status, stripe_checkout_session_id") {
              return {
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: orderId,
                      status: "pending_approval",
                      stripe_checkout_session_id: "cs_approval",
                    },
                    error: null,
                  }),
                }),
              };
            }
            return {
              order: () => ({
                limit: async () => ({
                  data: [adminOrdersResult("canceled")],
                  error: null,
                }),
              }),
            };
          },
          update: (payload: unknown) => {
            mocks.updates.push(payload);
            return {
              eq: async () => ({ error: null }),
            };
          },
        };
      }

      if (table === "order_items") {
        return {
          select: () => ({
            in: () => ({
              order: async () => ({ data: orderItemRows, error: null }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    await denyApprovalOrderWithRefund(orderId);

    expect(mocks.retrieveSession).toHaveBeenCalledWith("cs_approval");
    expect(mocks.createRefund).toHaveBeenCalledWith({
      payment_intent: "pi_approval",
      metadata: {
        order_id: orderId,
        reason: "after_cutoff_approval_denied",
      },
    });
    expect(mocks.updates[0]).toMatchObject({
      status: "canceled",
      stripe_refund_id: "re_approval",
      admin_decision_note: "Denied approval request and refunded payment.",
    });
  });
});
