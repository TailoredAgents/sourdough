import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  subscriptionItemUpdate: vi.fn(),
  customerUpdate: vi.fn(),
  membershipRevision: 4,
  claimAvailable: true,
  claimToken: "90000000-0000-4000-8000-000000000004",
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }),
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    subscriptionItems: { update: mocks.subscriptionItemUpdate },
    customers: { update: mocks.customerUpdate },
  }),
}));

vi.mock("@/lib/stripe-tax", () => ({
  updateStripeDeliveryCustomer: mocks.customerUpdate,
}));

import { reconcileBreadClubProviderState } from "./provider-sync";

const membershipId = "10000000-0000-4000-8000-000000000099";
const address = {
  line1: "123 Main Street",
  line2: "",
  city: "Canton",
  state: "GA",
  postalCode: "30114",
};

function singleResult(data: unknown) {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data, error: null }),
      }),
    }),
  };
}

beforeEach(() => {
  mocks.from.mockReset();
  mocks.rpc.mockReset();
  mocks.subscriptionItemUpdate.mockReset();
  mocks.customerUpdate.mockReset();
  mocks.membershipRevision = 4;
  mocks.claimAvailable = true;
  mocks.claimToken = "90000000-0000-4000-8000-000000000004";
  mocks.subscriptionItemUpdate.mockImplementation(
    async (_itemId: string, input: { price: string }) => ({
      id: "si_synced",
      price: { id: input.price },
    }),
  );
  mocks.customerUpdate.mockResolvedValue({ id: "cus_synced" });
  mocks.rpc.mockImplementation((name: string) => {
    if (name === "claim_bread_club_provider_sync") {
      return Promise.resolve({
        data: mocks.claimAvailable
          ? [
              {
                sync_revision: mocks.membershipRevision,
                sync_claim_token: mocks.claimToken,
              },
            ]
          : [],
        error: null,
      });
    }
    if (name === "finish_bread_club_provider_sync") {
      return Promise.resolve({ data: true, error: null });
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
  mocks.from.mockImplementation((table: string) => {
    if (table === "bread_club_memberships") {
      return singleResult({
        id: membershipId,
        stripe_customer_id: "cus_member",
        stripe_plan_subscription_item_id: "si_plan",
        stripe_delivery_subscription_item_id: "si_delivery",
        provider_sync_revision: mocks.membershipRevision,
        provider_sync_required: true,
        provider_sync_claim_token: mocks.claimToken,
        provider_desired_plan_price_id: "price_plan_next",
        provider_desired_plan_price_cents: 5200,
        provider_desired_delivery_price_id: "price_delivery_next",
        provider_desired_delivery_price_cents: 2800,
        provider_desired_delivery_address: address,
        provider_desired_customer_name: "Member",
        provider_desired_customer_phone: "7705550100",
      });
    }
    throw new Error(`Unexpected table ${table}`);
  });
});

describe("Bread Club provider reconciliation", () => {
  it("converges both prices and the tax address with revision-stable idempotency", async () => {
    await expect(
      reconcileBreadClubProviderState(membershipId, 4),
    ).resolves.toBe(true);

    expect(mocks.rpc).toHaveBeenNthCalledWith(
      1,
      "claim_bread_club_provider_sync",
      {
        p_membership_id: membershipId,
        p_expected_revision: 4,
      },
    );
    expect(mocks.subscriptionItemUpdate).toHaveBeenNthCalledWith(
      1,
      "si_plan",
      { price: "price_plan_next", proration_behavior: "none" },
      {
        idempotencyKey: `bread-club-provider-plan-${membershipId}-4`,
      },
    );
    expect(mocks.subscriptionItemUpdate).toHaveBeenNthCalledWith(
      2,
      "si_delivery",
      { price: "price_delivery_next", proration_behavior: "none" },
      {
        idempotencyKey: `bread-club-provider-delivery-${membershipId}-4`,
      },
    );
    expect(mocks.customerUpdate).toHaveBeenCalledWith(
      expect.anything(),
      "cus_member",
      expect.objectContaining({ address }),
      {
        idempotencyKey: `bread-club-provider-address-${membershipId}-4`,
      },
    );
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      "finish_bread_club_provider_sync",
      {
        p_membership_id: membershipId,
        p_revision: 4,
        p_claim_token: mocks.claimToken,
        p_error: null,
      },
    );
  });

  it("quarantines an ambiguous provider failure and later retries the immutable revision with the same key", async () => {
    mocks.subscriptionItemUpdate.mockRejectedValueOnce(
      new Error("Stripe request timed out"),
    );

    await expect(
      reconcileBreadClubProviderState(membershipId, 4),
    ).rejects.toThrow("Stripe request timed out");
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      "finish_bread_club_provider_sync",
      expect.objectContaining({
        p_membership_id: membershipId,
        p_revision: 4,
        p_claim_token: mocks.claimToken,
        p_error: "Stripe request timed out",
      }),
    );

    await expect(
      reconcileBreadClubProviderState(membershipId, 4),
    ).resolves.toBe(true);
    expect(
      mocks.subscriptionItemUpdate.mock.calls
        .filter(([itemId]) => itemId === "si_plan")
        .map((call) => call[2]?.idempotencyKey),
    ).toEqual([
      `bread-club-provider-plan-${membershipId}-4`,
      `bread-club-provider-plan-${membershipId}-4`,
    ]);
  });

  it("does not let a stale worker overwrite a newer desired revision", async () => {
    mocks.membershipRevision = 5;
    mocks.claimAvailable = false;

    await expect(
      reconcileBreadClubProviderState(membershipId, 4),
    ).resolves.toBe(false);
    expect(mocks.subscriptionItemUpdate).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "claim_bread_club_provider_sync",
      {
        p_membership_id: membershipId,
        p_expected_revision: 4,
      },
    );
  });

  it("does not call Stripe when another worker holds the lease", async () => {
    mocks.claimAvailable = false;

    await expect(
      reconcileBreadClubProviderState(membershipId, 4),
    ).resolves.toBe(false);
    expect(mocks.subscriptionItemUpdate).not.toHaveBeenCalled();
    expect(mocks.customerUpdate).not.toHaveBeenCalled();
  });

  it("keeps reconciliation pending when Stripe returns the wrong price", async () => {
    mocks.subscriptionItemUpdate.mockResolvedValueOnce({
      id: "si_plan",
      price: { id: "price_unexpected" },
    });

    await expect(
      reconcileBreadClubProviderState(membershipId, 4),
    ).rejects.toThrow("Stripe returned an unexpected Bread Club plan price");
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      "finish_bread_club_provider_sync",
      expect.objectContaining({
        p_membership_id: membershipId,
        p_revision: 4,
        p_claim_token: mocks.claimToken,
        p_error: "Stripe returned an unexpected Bread Club plan price.",
      }),
    );
  });
});
