import { beforeEach, describe, expect, it, vi } from "vitest";
import { processOrderCompletionNotification } from "./order-notifications";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  sendOrderCompletionThankYou: vi.fn(),
}));

vi.mock("./supabase", () => ({
  getSupabaseAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));

vi.mock("./email", () => ({
  sendOrderCompletionThankYou: mocks.sendOrderCompletionThankYou,
}));

const orderId = "11111111-1111-4111-8111-111111111111";
const claimToken = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.from.mockReset();
  mocks.sendOrderCompletionThankYou.mockReset();
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === "claim_order_notification_job") {
      return { data: claimToken, error: null };
    }
    if (name === "finish_order_notification_job") {
      return { data: true, error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
  mocks.from.mockImplementation((table: string) => {
    if (table === "orders") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: orderId,
                  customers: {
                    name: "First Customer",
                    email: "customer@example.com",
                  },
                  delivery_windows: {
                    label: "Sunday, Aug 9, 3:00-6:00 PM",
                  },
                },
                error: null,
              }),
            }),
          }),
        }),
      };
    }
    if (table === "order_items") {
      return {
        select: () => ({
          eq: async () => ({
            data: [
              {
                quantity: 1,
                products: { name: "Classic Country Loaf" },
              },
            ],
            error: null,
          }),
        }),
      };
    }
    if (table === "order_notification_jobs") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { status: "completed" },
              error: null,
            }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
  mocks.sendOrderCompletionThankYou.mockResolvedValue({ data: { id: "email-1" } });
});

describe("order notification outbox", () => {
  it("claims, sends, and lease-fences a completion thank-you", async () => {
    await expect(processOrderCompletionNotification(orderId)).resolves.toEqual({
      state: "sent",
    });
    expect(mocks.sendOrderCompletionThankYou).toHaveBeenCalledWith({
      to: "customer@example.com",
      customerName: "First Customer",
      orderSummary: "1 x Classic Country Loaf",
      deliveryWindow: "Sunday, Aug 9, 3:00-6:00 PM",
      orderId,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("finish_order_notification_job", {
      p_job_key: `completion-thank-you:${orderId}`,
      p_claim_token: claimToken,
      p_status: "completed",
      p_error_message: null,
    });
  });

  it("records a retryable failure without losing the job", async () => {
    mocks.sendOrderCompletionThankYou.mockRejectedValue(
      new Error("Temporary email outage"),
    );
    await expect(processOrderCompletionNotification(orderId)).rejects.toThrow(
      "Temporary email outage",
    );
    expect(mocks.rpc).toHaveBeenCalledWith("finish_order_notification_job", {
      p_job_key: `completion-thank-you:${orderId}`,
      p_claim_token: claimToken,
      p_status: "failed",
      p_error_message: "Temporary email outage",
    });
  });

  it("reports a previously completed thank-you truthfully after reopening", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    await expect(processOrderCompletionNotification(orderId)).resolves.toEqual({
      state: "already_sent",
    });
    expect(mocks.sendOrderCompletionThankYou).not.toHaveBeenCalled();
  });
});
