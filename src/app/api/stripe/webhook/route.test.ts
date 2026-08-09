import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  completeStorefrontCheckoutSession: vi.fn(),
  cancelExpiredCheckoutSession: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    webhooks: {
      constructEvent: mocks.constructEvent,
    },
  }),
}));

vi.mock("@/lib/order-records", () => ({
  cancelExpiredCheckoutSession: mocks.cancelExpiredCheckoutSession,
}));

vi.mock("@/lib/order-payment", () => ({
  completeStorefrontCheckoutSession:
    mocks.completeStorefrontCheckoutSession,
}));

async function postWebhook() {
  const { POST } = await import("./route");
  return POST(
    new Request("https://www.landlsourdough.com/api/stripe/webhook", {
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

describe("Stripe order webhook", () => {
  it("routes completed Checkout Sessions through the paid-order workflow", async () => {
    const session = {
      id: "cs_approval",
      payment_status: "paid",
      amount_total: 3210,
      total_details: { amount_tax: 210 },
      customer_email: "customer@example.com",
      metadata: { order_id: "order-id" },
    };
    mocks.constructEvent.mockReturnValue({
      id: "evt_approval",
      type: "checkout.session.completed",
      data: {
        object: session,
      },
    });
    mocks.completeStorefrontCheckoutSession.mockResolvedValue({
      orderId: "order-id",
    });

    const response = await postWebhook();

    await expect(response.json()).resolves.toEqual({ received: true });
    expect(
      mocks.completeStorefrontCheckoutSession,
    ).toHaveBeenCalledWith(
      session,
    );
  });

  it("routes a delayed payment success through the same paid-order workflow", async () => {
    const session = {
      id: "cs_delayed",
      payment_status: "paid",
      amount_total: 3210,
      total_details: { amount_tax: 210 },
    };
    mocks.constructEvent.mockReturnValue({
      id: "evt_delayed_paid",
      type: "checkout.session.async_payment_succeeded",
      data: { object: session },
    });

    const response = await postWebhook();

    expect(response.status).toBe(200);
    expect(mocks.completeStorefrontCheckoutSession).toHaveBeenCalledWith(session);
  });

  it("releases a delayed payment that ultimately fails", async () => {
    const orderId = "11111111-1111-4111-8111-111111111111";
    const session = {
      id: "cs_delayed_failed",
      payment_status: "unpaid",
      metadata: { order_id: orderId },
    };
    mocks.constructEvent.mockReturnValue({
      id: "evt_delayed_failed",
      type: "checkout.session.async_payment_failed",
      data: { object: session },
    });
    mocks.cancelExpiredCheckoutSession.mockResolvedValue("order-id");

    const response = await postWebhook();

    expect(response.status).toBe(200);
    expect(mocks.cancelExpiredCheckoutSession).toHaveBeenCalledWith(
      "cs_delayed_failed",
      orderId,
    );
    expect(mocks.completeStorefrontCheckoutSession).not.toHaveBeenCalled();
  });
});
