import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  attachStripeSessionToOrder: vi.fn(),
  markCheckoutSessionPaid: vi.fn(),
  getPaidCheckoutOrderSummaryBySessionId: vi.fn(),
  hasSentEmailEvent: vi.fn(),
  sendCustomerApprovalRequestReceived: vi.fn(),
  sendCustomerOrderConfirmation: vi.fn(),
  sendOwnerApprovalRequestNotification: vi.fn(),
  sendOwnerNewOrderNotification: vi.fn(),
  sendOwnerAlert: vi.fn(),
}));

vi.mock("./order-records", () => ({
  attachStripeSessionToOrder: mocks.attachStripeSessionToOrder,
  markCheckoutSessionPaid: mocks.markCheckoutSessionPaid,
  getPaidCheckoutOrderSummaryBySessionId:
    mocks.getPaidCheckoutOrderSummaryBySessionId,
}));

vi.mock("./email", () => ({
  hasSentEmailEvent: mocks.hasSentEmailEvent,
  sendCustomerApprovalRequestReceived:
    mocks.sendCustomerApprovalRequestReceived,
  sendCustomerOrderConfirmation: mocks.sendCustomerOrderConfirmation,
  sendOwnerApprovalRequestNotification:
    mocks.sendOwnerApprovalRequestNotification,
  sendOwnerNewOrderNotification: mocks.sendOwnerNewOrderNotification,
}));

vi.mock("./owner-alerts", () => ({
  sendOwnerAlert: mocks.sendOwnerAlert,
}));

const paidOrder = {
  orderId: "order-1",
  status: "paid",
  customerName: "First Customer",
  customerEmail: "customer@example.com",
  customerPhone: "4705550100",
  orderSummary: "1 x Classic Country Loaf",
  deliveryWindow: "Sunday, Aug 2, 3:00 PM-6:00 PM",
  deliveryAddress: "123 Main Street, Canton, GA 30114",
  notes: "Leave by the door.",
};

const session = {
  id: "cs_paid",
  payment_status: "paid",
  currency: "usd",
  amount_subtotal: 1800,
  amount_total: 1800,
  total_details: { amount_tax: 0 },
  customer_email: "customer@example.com",
};

beforeEach(() => {
  process.env.BAKERY_EMAIL = "owner@example.com";
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.hasSentEmailEvent.mockResolvedValue(false);
  mocks.sendCustomerOrderConfirmation.mockResolvedValue({});
  mocks.sendOwnerNewOrderNotification.mockResolvedValue({});
  mocks.sendOwnerAlert.mockResolvedValue(undefined);
});

describe("completed storefront checkout", () => {
  it("does not fulfill a Checkout Session while payment is still unpaid", async () => {
    const { completeStorefrontCheckoutSession } = await import(
      "./order-payment"
    );

    await expect(
      completeStorefrontCheckoutSession({
        ...session,
        payment_status: "unpaid",
      } as never),
    ).resolves.toBeNull();

    expect(mocks.markCheckoutSessionPaid).not.toHaveBeenCalled();
    expect(mocks.sendCustomerOrderConfirmation).not.toHaveBeenCalled();
    expect(mocks.sendOwnerNewOrderNotification).not.toHaveBeenCalled();
    expect(mocks.sendOwnerAlert).not.toHaveBeenCalled();
  });

  it("marks the order paid and sends customer, owner, and short alerts", async () => {
    mocks.markCheckoutSessionPaid.mockResolvedValue(paidOrder);

    const { completeStorefrontCheckoutSession } = await import(
      "./order-payment"
    );
    await completeStorefrontCheckoutSession(session as never);

    expect(mocks.markCheckoutSessionPaid).toHaveBeenCalledWith("cs_paid", {
      currency: "usd",
      subtotalCents: 1800,
      taxCents: 0,
      totalCents: 1800,
    });
    expect(mocks.sendCustomerOrderConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "customer@example.com",
        orderId: "order-1",
      }),
    );
    expect(mocks.sendOwnerNewOrderNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "owner@example.com",
        customerName: "First Customer",
        customerPhone: "4705550100",
        notes: "Leave by the door.",
      }),
    );
    expect(mocks.sendOwnerAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "order",
        customerName: "First Customer",
        orderSummary: "1 x Classic Country Loaf",
        notes: "Leave by the door.",
      }),
    );
  });

  it("recovers a missing database attachment from signed session metadata", async () => {
    const orderId = "11111111-1111-4111-8111-111111111111";
    mocks.markCheckoutSessionPaid.mockResolvedValue({
      ...paidOrder,
      orderId,
    });

    const { completeStorefrontCheckoutSession } = await import(
      "./order-payment"
    );
    await completeStorefrontCheckoutSession({
      ...session,
      metadata: { order_id: orderId },
    } as never);

    expect(mocks.attachStripeSessionToOrder).toHaveBeenCalledWith(
      orderId,
      "cs_paid",
    );
    expect(mocks.markCheckoutSessionPaid).toHaveBeenCalled();
  });

  it("retries missing notifications after the order is already paid", async () => {
    mocks.markCheckoutSessionPaid
      .mockResolvedValueOnce(paidOrder)
      .mockResolvedValueOnce(null);
    mocks.getPaidCheckoutOrderSummaryBySessionId.mockResolvedValue(paidOrder);
    mocks.sendCustomerOrderConfirmation
      .mockRejectedValueOnce(new Error("Temporary Resend failure"))
      .mockResolvedValueOnce({});

    const { completeStorefrontCheckoutSession } = await import(
      "./order-payment"
    );
    await expect(
      completeStorefrontCheckoutSession(session as never),
    ).rejects.toThrow("Temporary Resend failure");
    await expect(
      completeStorefrontCheckoutSession(session as never),
    ).resolves.toEqual(paidOrder);

    expect(mocks.sendCustomerOrderConfirmation).toHaveBeenCalledTimes(2);
    expect(mocks.sendOwnerNewOrderNotification).toHaveBeenCalledTimes(1);
    expect(mocks.sendOwnerAlert).toHaveBeenCalledTimes(1);
  });
});
