import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  markCheckoutSessionPaid: vi.fn(),
  cancelExpiredCheckoutSession: vi.fn(),
  sendCustomerApprovalRequestReceived: vi.fn(),
  sendCustomerOrderConfirmation: vi.fn(),
  sendOwnerApprovalRequestNotification: vi.fn(),
  sendOwnerNewOrderNotification: vi.fn(),
  sendOwnerAlert: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    webhooks: {
      constructEvent: mocks.constructEvent,
    },
  }),
}));

vi.mock("@/lib/order-records", () => ({
  markCheckoutSessionPaid: mocks.markCheckoutSessionPaid,
  cancelExpiredCheckoutSession: mocks.cancelExpiredCheckoutSession,
}));

vi.mock("@/lib/email", () => ({
  sendCustomerApprovalRequestReceived: mocks.sendCustomerApprovalRequestReceived,
  sendCustomerOrderConfirmation: mocks.sendCustomerOrderConfirmation,
  sendOwnerApprovalRequestNotification: mocks.sendOwnerApprovalRequestNotification,
  sendOwnerNewOrderNotification: mocks.sendOwnerNewOrderNotification,
}));

vi.mock("@/lib/owner-alerts", () => ({
  sendOwnerAlert: mocks.sendOwnerAlert,
}));

async function postWebhook() {
  const { POST } = await import("./route");
  return POST(
    new Request("https://landlsourdough.com/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "test-signature" },
      body: JSON.stringify({ id: "evt_test" }),
    }),
  );
}

beforeEach(() => {
  vi.resetModules();
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  process.env.BAKERY_EMAIL = "owner@example.com";
  for (const mock of Object.values(mocks)) {
    mock.mockReset();
  }
});

describe("Stripe approval request webhook", () => {
  it("routes paid same-week requests to approval emails and owner alert", async () => {
    mocks.constructEvent.mockReturnValue({
      id: "evt_approval",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_approval",
          customer_email: "customer@example.com",
          metadata: { order_id: "order-id" },
        },
      },
    });
    mocks.markCheckoutSessionPaid.mockResolvedValue({
      orderId: "order-id",
      status: "pending_approval",
      customerName: "Same Week Customer",
      customerEmail: "customer@example.com",
      customerPhone: "4045550100",
      orderSummary: "2 x Classic Country Loaf",
      deliveryWindow: "Thursday, Jul 23, 9:00 AM-12:00 PM",
      deliveryAddress: "123 Main Street, Canton, GA 30114",
      notes: "Please slice if possible.",
    });

    const response = await postWebhook();

    await expect(response.json()).resolves.toEqual({ received: true });
    expect(mocks.markCheckoutSessionPaid).toHaveBeenCalledWith("cs_approval");
    expect(mocks.sendCustomerApprovalRequestReceived).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "customer@example.com",
        customerName: "Same Week Customer",
        orderSummary: "2 x Classic Country Loaf",
        orderId: "order-id",
      }),
    );
    expect(mocks.sendOwnerApprovalRequestNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "owner@example.com",
        customerName: "Same Week Customer",
        customerPhone: "4045550100",
        address: "123 Main Street, Canton, GA 30114",
        notes: "Please slice if possible.",
      }),
    );
    expect(mocks.sendOwnerAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "order",
        customerName: "Same Week Customer",
        notes: expect.stringContaining("Paid same-week approval request"),
      }),
    );
    expect(mocks.sendCustomerOrderConfirmation).not.toHaveBeenCalled();
    expect(mocks.sendOwnerNewOrderNotification).not.toHaveBeenCalled();
  });
});
