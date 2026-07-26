import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  retrieveSession: vi.fn(),
  completeStorefrontCheckoutSession: vi.fn(),
  cancelExpiredCheckoutSession: vi.fn(),
  pendingOrders: [] as Array<{
    id: string;
    stripe_checkout_session_id: string;
  }>,
}));

vi.mock("./stripe", () => ({
  getStripe: () => ({
    checkout: {
      sessions: {
        retrieve: mocks.retrieveSession,
      },
    },
  }),
}));

vi.mock("./supabase", () => ({
  getSupabaseAdminClient: () => {
    const query = {
      select: vi.fn(() => query),
      in: vi.fn(() => query),
      not: vi.fn(() => query),
      gte: vi.fn(() => query),
      order: vi.fn(() => query),
      limit: vi.fn(async () => ({
        data: mocks.pendingOrders,
        error: null,
      })),
    };
    return { from: vi.fn(() => query) };
  },
}));

vi.mock("./order-payment", () => ({
  completeStorefrontCheckoutSession:
    mocks.completeStorefrontCheckoutSession,
}));

vi.mock("./order-records", () => ({
  cancelExpiredCheckoutSession: mocks.cancelExpiredCheckoutSession,
}));

beforeEach(() => {
  mocks.pendingOrders = [
    { id: "paid-order", stripe_checkout_session_id: "cs_paid" },
    { id: "expired-order", stripe_checkout_session_id: "cs_expired" },
  ];
  mocks.retrieveSession.mockReset();
  mocks.completeStorefrontCheckoutSession.mockReset();
  mocks.cancelExpiredCheckoutSession.mockReset();
  mocks.retrieveSession
    .mockResolvedValueOnce({
      id: "cs_paid",
      status: "complete",
      payment_status: "paid",
    })
    .mockResolvedValueOnce({
      id: "cs_expired",
      status: "expired",
      payment_status: "unpaid",
    });
  mocks.completeStorefrontCheckoutSession.mockResolvedValue({
    orderId: "paid-order",
  });
  mocks.cancelExpiredCheckoutSession.mockResolvedValue("expired-order");
});

describe("storefront Checkout reconciliation", () => {
  it("recovers paid sessions and releases expired reservations", async () => {
    const { reconcileStorefrontCheckoutSessions } = await import(
      "./order-reconciliation"
    );

    const report = await reconcileStorefrontCheckoutSessions(
      new Date("2026-07-26T12:00:00Z"),
    );

    expect(report).toEqual({
      checked: 2,
      paidOrdersRecovered: 1,
      expiredOrdersReleased: 1,
      errors: [],
    });
    expect(mocks.completeStorefrontCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cs_paid" }),
    );
    expect(mocks.cancelExpiredCheckoutSession).toHaveBeenCalledWith(
      "cs_expired",
    );
  });
});
