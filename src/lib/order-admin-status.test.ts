import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateAdminOrderStatus } from "./order-admin";
import type { OrderStatus } from "./types";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  sendOrderCompletionThankYou: vi.fn(),
  sendOrderStatusUpdate: vi.fn(),
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("./supabase", () => ({
  getSupabaseAdminClient: () => ({
    from: mocks.from,
    rpc: vi.fn(),
  }),
}));

vi.mock("./email", () => ({
  sendOrderCompletionThankYou: mocks.sendOrderCompletionThankYou,
  sendOrderStatusUpdate: mocks.sendOrderStatusUpdate,
}));

vi.mock("./stripe", () => ({
  getStripe: () => null,
}));

const orderId = "11111111-1111-4111-8111-111111111111";

function orderRow(status: OrderStatus) {
  return {
    id: orderId,
    source: "storefront",
    bread_club_membership_id: null,
    bread_club_fulfillment_id: null,
    stripe_invoice_id: null,
    delivery_window_id: "22222222-2222-4222-8222-222222222222",
    customers: {
      name: "First Customer",
      email: "customer@example.com",
      phone: "4045550100",
    },
    delivery_windows: {
      label: "Sunday, Aug 2, 3:00 PM-6:00 PM",
      weekly_menu_id: "33333333-3333-4333-8333-333333333333",
      weekly_menus: {
        name: "First Bake Drop",
        starts_at: "2026-07-29T12:00:00.000Z",
      },
    },
    status,
    stripe_checkout_session_id: "cs_first_order",
    subtotal_cents: 1200,
    delivery_fee_cents: 600,
    tax_cents: 0,
    total_cents: 1800,
    delivery_address: {
      line1: "123 Main Street",
      city: "Canton",
      state: "GA",
      postalCode: "30114",
    },
    delivery_miles: 4.2,
    delivery_instructions: "Leave by the front door.",
    delivery_check: null,
    notes: null,
    next_week_ok: false,
    approval_mode: "standard",
    approved_at: null,
    denied_at: null,
    refunded_at: null,
    stripe_refund_id: null,
    admin_decision_note: null,
    paid_at: "2026-07-29T14:00:00.000Z",
    created_at: "2026-07-29T14:00:00.000Z",
    updated_at: "2026-07-29T14:00:00.000Z",
    checkout_cancel_token: "cancel-token",
  };
}

const orderItemRows = [
  {
    id: "44444444-4444-4444-8444-444444444444",
    order_id: orderId,
    product_id: "55555555-5555-4555-8555-555555555555",
    quantity: 1,
    unit_price_cents: 1200,
    products: { name: "Classic Country Loaf" },
  },
];

function setupOrderUpdate(existingStatus: OrderStatus, nextStatus: OrderStatus) {
  mocks.from.mockImplementation((table: string) => {
    if (table === "orders") {
      return {
        select: (columns: string) => {
          if (columns === "status, paid_at, delivery_window_id") {
            return {
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    status: existingStatus,
                    paid_at: "2026-07-29T14:00:00.000Z",
                    delivery_window_id:
                      "22222222-2222-4222-8222-222222222222",
                  },
                  error: null,
                }),
              }),
            };
          }

          return {
            order: () => ({
              limit: async () => ({ data: [orderRow(nextStatus)], error: null }),
            }),
          };
        },
        update: (payload: Record<string, unknown>) => {
          mocks.updates.push(payload);
          return { eq: async () => ({ error: null }) };
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
}

beforeEach(() => {
  mocks.from.mockReset();
  mocks.sendOrderCompletionThankYou.mockReset();
  mocks.sendOrderStatusUpdate.mockReset();
  mocks.sendOrderCompletionThankYou.mockResolvedValue({ data: { id: "thanks" } });
  mocks.sendOrderStatusUpdate.mockResolvedValue({ data: { id: "status" } });
  mocks.updates.length = 0;
});

describe("admin order status customer emails", () => {
  it("sends the thank-you review email when an order is completed", async () => {
    setupOrderUpdate("paid", "delivered");

    await updateAdminOrderStatus(orderId, "delivered");

    expect(mocks.sendOrderCompletionThankYou).toHaveBeenCalledWith({
      to: "customer@example.com",
      customerName: "First Customer",
      orderSummary: "1 x Classic Country Loaf",
      deliveryWindow: "Sunday, Aug 2, 3:00 PM-6:00 PM",
      orderId,
    });
    expect(mocks.sendOrderStatusUpdate).not.toHaveBeenCalled();
  });

  it("keeps ordinary progress updates on the status email", async () => {
    setupOrderUpdate("paid", "baking");

    await updateAdminOrderStatus(orderId, "baking");

    expect(mocks.sendOrderCompletionThankYou).not.toHaveBeenCalled();
    expect(mocks.sendOrderStatusUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "customer@example.com",
        statusLabel: "Baking soon",
      }),
    );
  });

  it("does not send another email when the status was already completed", async () => {
    setupOrderUpdate("delivered", "delivered");

    await updateAdminOrderStatus(orderId, "delivered");

    expect(mocks.sendOrderCompletionThankYou).not.toHaveBeenCalled();
    expect(mocks.sendOrderStatusUpdate).not.toHaveBeenCalled();
  });
});
