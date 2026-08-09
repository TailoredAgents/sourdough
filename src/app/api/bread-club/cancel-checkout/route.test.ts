import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  getCheckout: vi.fn(),
  cancelCheckout: vi.fn(),
  retrieveSession: vi.fn(),
  expireSession: vi.fn(),
}));

vi.mock("@/lib/bread-club/records", () => ({
  getBreadClubCheckoutForCancellation: mocks.getCheckout,
  cancelBreadClubCheckoutByToken: mocks.cancelCheckout,
}));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    checkout: {
      sessions: {
        retrieve: mocks.retrieveSession,
        expire: mocks.expireSession,
      },
    },
  }),
}));
vi.mock("@/lib/utils", () => ({
  getSiteUrl: () => "https://www.landlsourdough.com",
}));

const membershipId = "10000000-0000-4000-8000-000000000001";
const cycleId = "20000000-0000-4000-8000-000000000001";

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getCheckout.mockResolvedValue({
    membershipId,
    cycleId,
    sessionId: "cs_subscription_open",
  });
  mocks.retrieveSession.mockResolvedValue({
    id: "cs_subscription_open",
    status: "open",
  });
  mocks.expireSession.mockResolvedValue({
    id: "cs_subscription_open",
    status: "expired",
  });
  mocks.cancelCheckout.mockResolvedValue(true);
});

describe("Bread Club subscription Checkout cancellation", () => {
  it("expires Stripe before releasing the reserved cycle", async () => {
    const response = await GET(
      new Request(
        `https://www.landlsourdough.com/api/bread-club/cancel-checkout?membership_id=${membershipId}&token=secret`,
      ),
    );

    expect(response.status).toBe(307);
    expect(mocks.expireSession).toHaveBeenCalledWith("cs_subscription_open");
    expect(mocks.cancelCheckout).toHaveBeenCalledWith(
      membershipId,
      "secret",
      "cs_subscription_open",
      cycleId,
    );
    expect(mocks.expireSession.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.cancelCheckout.mock.invocationCallOrder[0],
    );
  });

  it("does not release a checkout Stripe already completed", async () => {
    mocks.retrieveSession.mockResolvedValue({
      id: "cs_subscription_open",
      status: "complete",
    });

    const response = await GET(
      new Request(
        `https://www.landlsourdough.com/api/bread-club/cancel-checkout?membership_id=${membershipId}&token=secret`,
      ),
    );

    expect(mocks.expireSession).not.toHaveBeenCalled();
    expect(mocks.cancelCheckout).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain(
      "/bread-club/success?session_id=cs_subscription_open",
    );
  });
});
