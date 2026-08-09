import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BreadClubAddonCheckoutError,
  createBreadClubAddonCheckout,
} from "./member-actions";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  getMember: vi.fn(),
  createSession: vi.fn(),
  retrieveSession: vi.fn(),
  expireSession: vi.fn(),
  failFirstAttach: false,
  attachCalls: 0,
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdminClient: () => ({
    from: mocks.from,
    rpc: mocks.rpc,
  }),
}));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    checkout: {
      sessions: {
        create: mocks.createSession,
        retrieve: mocks.retrieveSession,
        expire: mocks.expireSession,
      },
    },
  }),
}));
vi.mock("./member-data", () => ({
  getBreadClubMemberData: mocks.getMember,
}));
vi.mock("./config", () => ({
  isBreadClubAutomaticTaxEnabled: () => false,
}));
vi.mock("./emails", () => ({
  sendBreadClubCancellation: vi.fn(),
  sendBreadClubAddonReceipt: vi.fn(),
  sendBreadClubPlanChange: vi.fn(),
  sendBreadClubSkipCredit: vi.fn(),
}));
vi.mock("@/lib/utils", () => ({
  getSiteUrl: () => "https://www.landlsourdough.com",
}));

const membershipId = "10000000-0000-4000-8000-000000000001";
const fulfillmentId = "20000000-0000-4000-8000-000000000001";
const productId = "30000000-0000-4000-8000-000000000001";
const checkoutAttemptId = "40000000-0000-4000-8000-000000000001";
const addonId = "50000000-0000-4000-8000-000000000001";

beforeEach(() => {
  for (const mock of [
    mocks.from,
    mocks.rpc,
    mocks.getMember,
    mocks.createSession,
    mocks.retrieveSession,
    mocks.expireSession,
  ]) {
    mock.mockReset();
  }
  mocks.failFirstAttach = false;
  mocks.attachCalls = 0;
  mocks.getMember.mockResolvedValue({
    id: membershipId,
    customerEmail: "member@example.com",
    stripeCustomerId: "cus_bread_club",
    fulfillments: [
      {
        id: fulfillmentId,
        status: "scheduled",
        weeklyMenuId: "60000000-0000-4000-8000-000000000001",
      },
    ],
  });
  mocks.from.mockImplementation((table: string) => {
    if (table === "bread_club_addon_checkouts") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      };
    }
    if (table === "weekly_menu_items") {
      return {
        select: () => ({
          eq: () => ({
            in: async () => ({
              data: [
                {
                  product_id: productId,
                  available_quantity: 10,
                  sold_quantity: 1,
                  unavailable: false,
                  products: {
                    id: productId,
                    name: "Sea Salt Butter",
                    category: "add-on",
                    price_cents: 800,
                    stripe_price_id: "price_sea_salt_butter",
                    stripe_price_cents: 800,
                    active: true,
                  },
                },
              ],
              error: null,
            }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
  mocks.rpc.mockImplementation((name: string) => {
    if (name === "create_bread_club_addon_checkout") {
      return Promise.resolve({
        data: {
          addon_checkout_id: addonId,
          membership_id: membershipId,
          fulfillment_id: fulfillmentId,
          items: [
            {
              product_id: productId,
              quantity: 2,
              unit_price_cents: 800,
              stripe_price_id: "price_sea_salt_butter",
              name: "Sea Salt Butter",
            },
          ],
          subtotal_cents: 1600,
          checkout_cancel_token: "a".repeat(48),
          checkout_expires_at: "2099-08-08T20:00:00.000Z",
          checkout_automatic_tax_enabled: false,
          stripe_checkout_session_id: null,
          replayed: false,
        },
        error: null,
      });
    }
    if (name === "attach_bread_club_addon_checkout") {
      mocks.attachCalls += 1;
      if (mocks.failFirstAttach && mocks.attachCalls === 1) {
        return Promise.resolve({
          data: null,
          error: { message: "temporary attach failure" },
        });
      }
      return Promise.resolve({ data: true, error: null });
    }
    if (name === "cancel_bread_club_addon_checkout") {
      return Promise.resolve({ data: true, error: null });
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
  mocks.createSession.mockResolvedValue({
    id: "cs_addon",
    status: "open",
    url: "https://checkout.stripe.com/c/addon",
  });
  mocks.expireSession.mockResolvedValue({
    id: "cs_addon",
    status: "expired",
  });
});

describe("Bread Club add-on Checkout", () => {
  it("creates the attempt atomically and uses stable Stripe idempotency", async () => {
    await expect(
      createBreadClubAddonCheckout(
        membershipId,
        fulfillmentId,
        [{ productId, quantity: 2 }],
        checkoutAttemptId,
      ),
    ).resolves.toEqual({ url: "https://checkout.stripe.com/c/addon" });

    expect(mocks.rpc).toHaveBeenCalledWith(
      "create_bread_club_addon_checkout",
      expect.objectContaining({
        p_checkout_attempt_id: checkoutAttemptId,
        p_membership_id: membershipId,
        p_fulfillment_id: fulfillmentId,
        p_subtotal_cents: 1600,
        p_automatic_tax_enabled: false,
      }),
    );
    expect(mocks.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        expires_at: expect.any(Number),
        line_items: [{ price: "price_sea_salt_butter", quantity: 2 }],
        cancel_url: expect.stringContaining("/cancel-addon-checkout?"),
      }),
      { idempotencyKey: `bread-club-addon-${checkoutAttemptId}` },
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "attach_bread_club_addon_checkout",
      {
        p_addon_checkout_id: addonId,
        p_session_id: "cs_addon",
      },
    );
  });

  it("expires Stripe before releasing inventory after attachment failure", async () => {
    mocks.failFirstAttach = true;

    const promise = createBreadClubAddonCheckout(
      membershipId,
      fulfillmentId,
      [{ productId, quantity: 2 }],
      checkoutAttemptId,
    );

    await expect(promise).rejects.toMatchObject({
      resetCheckoutAttempt: true,
    } satisfies Partial<BreadClubAddonCheckoutError>);
    const cancelCallIndex = mocks.rpc.mock.calls.findIndex(
      ([name]) => name === "cancel_bread_club_addon_checkout",
    );
    expect(cancelCallIndex).toBeGreaterThan(-1);
    expect(mocks.expireSession.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rpc.mock.invocationCallOrder[cancelCallIndex],
    );
  });
});
