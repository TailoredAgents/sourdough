import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  reconcileCanceledBreadClubCreditRefunds,
  reconcileStaleBreadClubSubscriptionCheckout,
  subscriptionDetails,
} from "./daily";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  retrieveCheckoutSession: vi.fn(),
  expireCheckoutSession: vi.fn(),
  reconcileSubscriptionCheckout: vi.fn(),
  markBreadClubCheckoutIncomplete: vi.fn(),
  expireBreadClubCheckoutSession: vi.fn(),
  refundBreadClubUnusedCredits: vi.fn(),
  reconcileBreadClubPendingRefunds: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    checkout: {
      sessions: {
        retrieve: mocks.retrieveCheckoutSession,
        expire: mocks.expireCheckoutSession,
      },
    },
  }),
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdminClient: () => ({
    from: mocks.from,
  }),
}));

vi.mock("./records", () => ({
  expireBreadClubCheckoutSession:
    mocks.expireBreadClubCheckoutSession,
  markBreadClubCheckoutIncomplete:
    mocks.markBreadClubCheckoutIncomplete,
  prepareNextBreadClubCycle: vi.fn(),
}));

vi.mock("./billing", () => ({
  refundBreadClubUnusedCredits:
    mocks.refundBreadClubUnusedCredits,
  reconcileBreadClubPendingRefunds:
    mocks.reconcileBreadClubPendingRefunds,
}));

vi.mock("./webhook", () => ({
  reconcileBreadClubSubscriptionCheckout:
    mocks.reconcileSubscriptionCheckout,
}));

const membershipId = "10000000-0000-4000-8000-000000000001";
const cycleId = "20000000-0000-4000-8000-000000000001";
const now = new Date("2026-08-08T16:00:00.000Z");

function pendingCheckout(
  overrides: Partial<{
    current_cycle_id: string | null;
    stripe_checkout_session_id: string | null;
    checkout_expires_at: string | null;
    created_at: string;
  }> = {},
) {
  return {
    id: membershipId,
    current_cycle_id: cycleId,
    stripe_checkout_session_id: "cs_subscription",
    checkout_expires_at: "2026-08-08T15:00:00.000Z",
    created_at: "2026-08-07T12:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.from.mockImplementation((table: string) => {
    if (table !== "bread_club_rollover_credits") {
      throw new Error(`Unexpected table ${table}`);
    }
    return {
      select: () => ({
        in: () => ({
          eq: async () => ({
            data: [
              {
                membership_id: membershipId,
                expires_at: "2026-08-08T18:00:00.000Z",
                bread_club_memberships: {
                  status: "canceled",
                  canceled_at: "2026-08-08T15:00:00.000Z",
                },
              },
            ],
            error: null,
          }),
        }),
      }),
    };
  });
});

describe("Bread Club daily reconciliation", () => {
  it("maps a canceled Stripe subscription to durable local cancellation fields", () => {
    const canceledAt = 1786204800;
    const details = subscriptionDetails(
      {
        id: "sub_canceled",
        status: "canceled",
        cancel_at_period_end: false,
        canceled_at: canceledAt,
        items: { data: [] },
      } as unknown as Stripe.Subscription,
      now,
    );

    expect(details).toEqual(
      expect.objectContaining({
        status: "canceled",
        cancelAtPeriodEnd: true,
        canceledAt: new Date(canceledAt * 1000).toISOString(),
      }),
    );
  });

  it("routes a completed subscription Checkout through the shared reconciler", async () => {
    const session = {
      id: "cs_subscription",
      status: "complete",
    } as unknown as Stripe.Checkout.Session;
    mocks.retrieveCheckoutSession.mockResolvedValue(session);
    mocks.reconcileSubscriptionCheckout.mockResolvedValue({
      membershipId,
      cycleId,
      checkoutRecorded: true,
      cycleState: "activated",
    });

    await expect(
      reconcileStaleBreadClubSubscriptionCheckout(
        pendingCheckout({
          checkout_expires_at: "2026-08-08T17:00:00.000Z",
        }),
        now,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        outcome: "completed",
        reconciliation: expect.objectContaining({
          cycleState: "activated",
        }),
      }),
    );

    expect(mocks.reconcileSubscriptionCheckout).toHaveBeenCalledWith(
      session,
      { membershipId, cycleId },
    );
    expect(mocks.expireCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.expireBreadClubCheckoutSession).not.toHaveBeenCalled();
  });

  it("leaves an attached open Checkout untouched before its persisted expiry", async () => {
    mocks.retrieveCheckoutSession.mockResolvedValue({
      id: "cs_subscription",
      status: "open",
    });

    await expect(
      reconcileStaleBreadClubSubscriptionCheckout(
        pendingCheckout({
          checkout_expires_at: "2026-08-08T17:00:00.000Z",
        }),
        now,
      ),
    ).resolves.toEqual({ outcome: "not_due" });

    expect(mocks.retrieveCheckoutSession).toHaveBeenCalledWith(
      "cs_subscription",
    );
    expect(mocks.expireCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.reconcileSubscriptionCheckout).not.toHaveBeenCalled();
    expect(mocks.markBreadClubCheckoutIncomplete).not.toHaveBeenCalled();
    expect(mocks.expireBreadClubCheckoutSession).not.toHaveBeenCalled();
  });

  it("expires and releases an attached open Checkout after its persisted expiry", async () => {
    mocks.retrieveCheckoutSession.mockResolvedValue({
      id: "cs_subscription",
      status: "open",
    });
    mocks.expireCheckoutSession.mockResolvedValue({
      id: "cs_subscription",
      status: "expired",
    });
    mocks.expireBreadClubCheckoutSession.mockResolvedValue(membershipId);

    await expect(
      reconcileStaleBreadClubSubscriptionCheckout(pendingCheckout(), now),
    ).resolves.toEqual({ outcome: "released" });

    expect(mocks.expireCheckoutSession).toHaveBeenCalledWith(
      "cs_subscription",
    );
    expect(mocks.expireBreadClubCheckoutSession).toHaveBeenCalledWith(
      "cs_subscription",
      membershipId,
    );
  });

  it("reports a canceled-credit refund failure and retries it on the next run", async () => {
    mocks.refundBreadClubUnusedCredits
      .mockRejectedValueOnce(
        new Error("Stripe refund is temporarily unavailable."),
      )
      .mockResolvedValueOnce([
        {
          kind: "rollover_credit",
          id: "credit-1",
          state: "refunded",
          attemptKey: "credit-refund-1",
          refundId: "re_1",
          refundStatus: "succeeded",
          amountCents: 2000,
        },
        {
          kind: "rollover_credit",
          id: "credit-2",
          state: "refund_pending",
          attemptKey: "credit-refund-2",
          refundId: "re_2",
          refundStatus: "pending",
          amountCents: 2000,
        },
      ]);

    await expect(
      reconcileCanceledBreadClubCreditRefunds(now),
    ).resolves.toEqual({
      membershipsAttempted: 1,
      creditsRefunded: 0,
      errors: [
        `Canceled membership ${membershipId} credits: Stripe refund is temporarily unavailable.`,
      ],
    });
    await expect(
      reconcileCanceledBreadClubCreditRefunds(now),
    ).resolves.toEqual({
      membershipsAttempted: 1,
      creditsRefunded: 1,
      errors: [],
    });

    expect(mocks.refundBreadClubUnusedCredits).toHaveBeenCalledTimes(2);
    expect(mocks.refundBreadClubUnusedCredits).toHaveBeenNthCalledWith(
      1,
      membershipId,
    );
    expect(mocks.refundBreadClubUnusedCredits).toHaveBeenNthCalledWith(
      2,
      membershipId,
    );
  });
});
