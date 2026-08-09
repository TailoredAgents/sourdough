import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStripe: vi.fn(),
  getSupabaseAdminClient: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({ getStripe: mocks.getStripe }));
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdminClient: mocks.getSupabaseAdminClient,
}));

import {
  refundBreadClubUnusedCredits,
  requestBreadClubCycleRefund,
  requestBreadClubRolloverCreditRefund,
} from "./billing";

function creditClaim(overrides: Record<string, unknown> = {}) {
  return {
    refund_state: "refund_pending",
    attempt_key: "bread-club-credit-refund:credit-1:1",
    refund_id: null,
    provider_status: null,
    membership_id: "membership-1",
    stripe_invoice_id: "in_credit",
    stripe_invoice_item_id: "ii_credit",
    amount_cents: 1300,
    ...overrides,
  };
}

function cycleClaim(overrides: Record<string, unknown> = {}) {
  return {
    refund_state: "refund_pending",
    attempt_key: "bread-club-cycle-refund:cycle-1:1",
    refund_id: null,
    provider_status: null,
    membership_id: "membership-1",
    stripe_invoice_id: "in_cycle",
    stripe_invoice_item_ids: [],
    amount_cents: 6400,
    ...overrides,
  };
}

function paidInvoicePayment() {
  return {
    data: [
      {
        status: "paid",
        payment: {
          payment_intent: "pi_paid",
          charge: "ch_paid",
        },
      },
    ],
  };
}

function stripeRefund(
  id: string,
  status: "pending" | "requires_action" | "succeeded" | "failed" | "canceled",
  failureReason: string | null = null,
) {
  return {
    id,
    status,
    failure_reason: failureReason,
  };
}

describe("Bread Club durable refund orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks a rollover credit refunded only after Stripe reports succeeded", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "begin_bread_club_credit_refund_attempt") {
        return { data: [creditClaim()], error: null };
      }
      if (name === "record_bread_club_credit_refund") {
        return { data: "refunded", error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });
    const create = vi.fn().mockResolvedValue(
      stripeRefund("re_credit_succeeded", "succeeded"),
    );
    const del = vi.fn().mockResolvedValue({ id: "ii_credit", deleted: true });
    mocks.getSupabaseAdminClient.mockReturnValue({ rpc });
    mocks.getStripe.mockReturnValue({
      invoiceItems: { del },
      invoicePayments: { list: vi.fn().mockResolvedValue(paidInvoicePayment()) },
      refunds: { create, retrieve: vi.fn() },
    });

    const result = await requestBreadClubRolloverCreditRefund("credit-1");

    expect(result).toMatchObject({
      state: "refunded",
      refundId: "re_credit_succeeded",
      refundStatus: "succeeded",
    });
    expect(del).toHaveBeenCalledWith("ii_credit");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1300, payment_intent: "pi_paid" }),
      { idempotencyKey: "bread-club-credit-refund:credit-1:1" },
    );
    expect(rpc).toHaveBeenCalledWith(
      "record_bread_club_credit_refund",
      expect.objectContaining({
        p_stripe_refund_status: "succeeded",
      }),
    );
  });

  it("retains a full cycle in refund_pending while Stripe is pending", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "begin_bread_club_cycle_refund_attempt") {
        return { data: [cycleClaim()], error: null };
      }
      if (name === "record_bread_club_cycle_refund") {
        return { data: "refund_pending", error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });
    mocks.getSupabaseAdminClient.mockReturnValue({ rpc });
    mocks.getStripe.mockReturnValue({
      invoicePayments: { list: vi.fn().mockResolvedValue(paidInvoicePayment()) },
      refunds: {
        create: vi.fn().mockResolvedValue(
          stripeRefund("re_cycle_pending", "pending"),
        ),
        retrieve: vi.fn(),
      },
    });

    const result = await requestBreadClubCycleRefund(
      "cycle-1",
      "Owner requested refund",
    );

    expect(result).toMatchObject({
      state: "refund_pending",
      refundId: "re_cycle_pending",
      refundStatus: "pending",
    });
    expect(rpc).toHaveBeenCalledWith(
      "record_bread_club_cycle_refund",
      expect.objectContaining({
        p_stripe_refund_status: "pending",
        p_last_error: "Stripe is still processing this refund.",
      }),
    );
  });

  it("replays the exact persisted idempotency key after a provider timeout", async () => {
    const claim = creditClaim({
      provider_status: "unknown",
      stripe_invoice_item_id: null,
    });
    const rpc = vi.fn(async (name: string) => {
      if (name === "begin_bread_club_credit_refund_attempt") {
        return { data: [claim], error: null };
      }
      if (name === "record_bread_club_credit_refund_error") {
        return { data: null, error: null };
      }
      if (name === "record_bread_club_credit_refund") {
        return { data: "refunded", error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection timed out"))
      .mockResolvedValueOnce(stripeRefund("re_replayed", "succeeded"));
    mocks.getSupabaseAdminClient.mockReturnValue({ rpc });
    mocks.getStripe.mockReturnValue({
      invoiceItems: { del: vi.fn() },
      invoicePayments: { list: vi.fn().mockResolvedValue(paidInvoicePayment()) },
      refunds: { create, retrieve: vi.fn() },
    });

    await expect(
      requestBreadClubRolloverCreditRefund("credit-1"),
    ).rejects.toThrow("connection timed out");
    const result = await requestBreadClubRolloverCreditRefund("credit-1");

    expect(result.state).toBe("refunded");
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[1]).toEqual({
      idempotencyKey: "bread-club-credit-refund:credit-1:1",
    });
    expect(create.mock.calls[1]?.[1]).toEqual({
      idempotencyKey: "bread-club-credit-refund:credit-1:1",
    });
    expect(rpc).toHaveBeenCalledWith(
      "record_bread_club_credit_refund_error",
      expect.objectContaining({ p_last_error: "connection timed out" }),
    );
  });

  it("records a failed refund honestly and uses a new persisted attempt for retry", async () => {
    const claims = [
      cycleClaim(),
      cycleClaim({
        attempt_key: "bread-club-cycle-refund:cycle-1:2",
        provider_status: null,
      }),
    ];
    const rpc = vi.fn(async (name: string) => {
      if (name === "begin_bread_club_cycle_refund_attempt") {
        return { data: [claims.shift()], error: null };
      }
      if (name === "record_bread_club_cycle_refund") {
        const callIndex = rpc.mock.calls.filter(
          ([rpcName]) => rpcName === "record_bread_club_cycle_refund",
        ).length;
        return {
          data: callIndex === 1 ? "refund_pending" : "refunded",
          error: null,
        };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });
    const create = vi
      .fn()
      .mockResolvedValueOnce(
        stripeRefund("re_failed", "failed", "expired_or_canceled_card"),
      )
      .mockResolvedValueOnce(stripeRefund("re_retry", "succeeded"));
    mocks.getSupabaseAdminClient.mockReturnValue({ rpc });
    mocks.getStripe.mockReturnValue({
      invoicePayments: { list: vi.fn().mockResolvedValue(paidInvoicePayment()) },
      refunds: { create, retrieve: vi.fn() },
    });

    const failed = await requestBreadClubCycleRefund("cycle-1");
    const retried = await requestBreadClubCycleRefund("cycle-1");

    expect(failed).toMatchObject({
      state: "refund_pending",
      refundStatus: "failed",
      refundId: "re_failed",
    });
    expect(retried).toMatchObject({
      state: "refunded",
      refundStatus: "succeeded",
      refundId: "re_retry",
    });
    expect(create.mock.calls.map((call) => call[1])).toEqual([
      { idempotencyKey: "bread-club-cycle-refund:cycle-1:1" },
      { idempotencyKey: "bread-club-cycle-refund:cycle-1:2" },
    ]);
    expect(rpc).toHaveBeenCalledWith(
      "record_bread_club_cycle_refund",
      expect.objectContaining({
        p_stripe_refund_status: "failed",
        p_last_error: "Stripe refund failed: expired_or_canceled_card",
      }),
    );
  });

  it("retrieves and advances an already-created pending refund", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "begin_bread_club_cycle_refund_attempt") {
        return {
          data: [
            cycleClaim({
              refund_id: "re_existing",
              provider_status: "requires_action",
            }),
          ],
          error: null,
        };
      }
      if (name === "record_bread_club_cycle_refund") {
        return { data: "refunded", error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });
    const retrieve = vi.fn().mockResolvedValue(
      stripeRefund("re_existing", "succeeded"),
    );
    const create = vi.fn();
    mocks.getSupabaseAdminClient.mockReturnValue({ rpc });
    mocks.getStripe.mockReturnValue({
      invoicePayments: { list: vi.fn() },
      refunds: { create, retrieve },
    });

    const result = await requestBreadClubCycleRefund("cycle-1");

    expect(result.state).toBe("refunded");
    expect(retrieve).toHaveBeenCalledWith("re_existing");
    expect(create).not.toHaveBeenCalled();
  });

  it("keeps credits refundable using the membership cancellation time", async () => {
    const canceledAt = "2026-08-08T15:00:00.000Z";
    const statusIn = vi.fn().mockReturnValue({
      gt: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    });
    const membershipMaybeSingle = vi.fn().mockResolvedValue({
      data: { status: "canceled", canceled_at: canceledAt },
      error: null,
    });
    const from = vi.fn((table: string) => {
      if (table === "bread_club_memberships") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: membershipMaybeSingle }),
          }),
        };
      }
      if (table === "bread_club_rollover_credits") {
        return {
          select: () => ({
            eq: () => ({ in: statusIn }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });
    mocks.getSupabaseAdminClient.mockReturnValue({ from });

    await expect(
      refundBreadClubUnusedCredits("membership-1"),
    ).resolves.toEqual([]);

    expect(statusIn).toHaveBeenCalledWith("status", [
      "available",
      "expired",
      "refund_pending",
    ]);
    const expirationFilter = statusIn.mock.results[0]?.value.gt;
    expect(expirationFilter).toHaveBeenCalledWith("expires_at", canceledAt);
  });
});
