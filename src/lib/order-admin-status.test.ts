import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateAdminOrderStatus } from "./order-admin";
import type { OrderStatus } from "./types";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  sendOrderCompletionThankYou: vi.fn(),
  sendOrderStatusUpdate: vi.fn(),
  processOrderCompletionNotification: vi.fn(),
  completeStorefrontCheckoutSession: vi.fn(),
  getStripe: vi.fn(),
  retrieveSession: vi.fn(),
  expireSession: vi.fn(),
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("./supabase", () => ({
  getSupabaseAdminClient: () => ({
    from: mocks.from,
    rpc: mocks.rpc,
  }),
}));

vi.mock("./email", () => ({
  sendOrderCompletionThankYou: mocks.sendOrderCompletionThankYou,
  sendOrderStatusUpdate: mocks.sendOrderStatusUpdate,
}));

vi.mock("./order-notifications", () => ({
  processOrderCompletionNotification:
    mocks.processOrderCompletionNotification,
}));

vi.mock("./order-payment", () => ({
  completeStorefrontCheckoutSession:
    mocks.completeStorefrontCheckoutSession,
}));

vi.mock("./stripe", () => ({
  getStripe: mocks.getStripe,
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

function adminOrdersQuery(data: unknown[]) {
  const ordered = {
    order: () => ({
      limit: async () => ({ data, error: null }),
    }),
  };
  return { ...ordered, eq: () => ordered };
}

function setupOrderUpdate(existingStatus: OrderStatus, nextStatus: OrderStatus) {
  mocks.from.mockImplementation((table: string) => {
    if (table === "orders") {
      return {
        select: (columns: string) => {
          if (
            columns ===
            "source, status, stripe_checkout_session_id, checkout_expires_at, created_at"
          ) {
            return {
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    source: "storefront",
                    status: existingStatus,
                    stripe_checkout_session_id: "cs_first_order",
                    checkout_expires_at: "2099-07-29T15:00:00.000Z",
                    created_at: "2026-07-29T14:00:00.000Z",
                  },
                  error: null,
                }),
              }),
            };
          }

          return adminOrdersQuery([orderRow(nextStatus)]);
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
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.sendOrderCompletionThankYou.mockReset();
  mocks.sendOrderStatusUpdate.mockReset();
  mocks.processOrderCompletionNotification.mockReset();
  mocks.completeStorefrontCheckoutSession.mockReset();
  mocks.getStripe.mockReset();
  mocks.retrieveSession.mockReset();
  mocks.expireSession.mockReset();
  mocks.sendOrderCompletionThankYou.mockResolvedValue({ data: { id: "thanks" } });
  mocks.sendOrderStatusUpdate.mockResolvedValue({ data: { id: "status" } });
  mocks.processOrderCompletionNotification.mockResolvedValue({ state: "sent" });
  mocks.completeStorefrontCheckoutSession.mockResolvedValue({ orderId });
  mocks.getStripe.mockReturnValue(null);
  mocks.updates.length = 0;
});

describe("admin order status customer emails", () => {
  it("sends the thank-you review email when an order is completed", async () => {
    setupOrderUpdate("paid", "delivered");

    await updateAdminOrderStatus(orderId, "delivered");

    expect(mocks.processOrderCompletionNotification).toHaveBeenCalledWith(orderId);
    expect(mocks.sendOrderStatusUpdate).not.toHaveBeenCalled();
  });

  it("keeps ordinary progress updates on the status email", async () => {
    setupOrderUpdate("paid", "baking");

    await updateAdminOrderStatus(orderId, "baking");

    expect(mocks.sendOrderCompletionThankYou).not.toHaveBeenCalled();
    expect(mocks.processOrderCompletionNotification).not.toHaveBeenCalled();
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
    expect(mocks.processOrderCompletionNotification).not.toHaveBeenCalled();
    expect(mocks.sendOrderStatusUpdate).not.toHaveBeenCalled();
  });

  it("expires an attached Stripe session before canceling an unpaid order", async () => {
    setupOrderUpdate("pending_payment", "canceled");
    mocks.getStripe.mockReturnValue({
      checkout: {
        sessions: {
          retrieve: mocks.retrieveSession,
          expire: mocks.expireSession,
        },
      },
    });
    mocks.retrieveSession.mockResolvedValue({
      id: "cs_first_order",
      status: "open",
    });
    mocks.expireSession.mockResolvedValue({
      id: "cs_first_order",
      status: "expired",
    });

    await updateAdminOrderStatus(orderId, "canceled", "owner@example.com");

    expect(mocks.expireSession).toHaveBeenCalledWith("cs_first_order");
    expect(mocks.rpc).toHaveBeenCalledWith("admin_cancel_storefront_checkout_scoped", {
      p_order_id: orderId,
      p_expected_weekly_menu_id: null,
      p_session_id: "cs_first_order",
      p_cancel_token: null,
      p_actor_email: "owner@example.com",
      p_reason:
        "Canceled by the bakery after Stripe checkout was confirmed closed.",
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "admin_transition_order_status_scoped",
      expect.anything(),
    );
  });

  it("never cancels inventory when Stripe reports a completed checkout", async () => {
    setupOrderUpdate("pending_payment", "canceled");
    mocks.getStripe.mockReturnValue({
      checkout: {
        sessions: {
          retrieve: mocks.retrieveSession,
          expire: mocks.expireSession,
        },
      },
    });
    const completedSession = {
      id: "cs_first_order",
      status: "complete",
      payment_status: "paid",
    };
    mocks.retrieveSession.mockResolvedValue(completedSession);

    await expect(
      updateAdminOrderStatus(orderId, "canceled", "owner@example.com"),
    ).rejects.toThrow(/already completed or is processing/i);

    expect(mocks.completeStorefrontCheckoutSession).toHaveBeenCalledWith(
      completedSession,
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "admin_cancel_storefront_checkout_scoped",
      expect.anything(),
    );
  });
});
