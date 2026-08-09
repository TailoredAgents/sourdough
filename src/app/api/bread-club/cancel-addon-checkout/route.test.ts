import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  getCheckout: vi.fn(),
  cancelCheckout: vi.fn(),
  retrieveSession: vi.fn(),
  expireSession: vi.fn(),
}));

vi.mock("@/lib/bread-club/member-actions", () => ({
  getBreadClubAddonCheckoutForCancellation: mocks.getCheckout,
  cancelBreadClubAddonCheckoutByToken: mocks.cancelCheckout,
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

const addonId = "30000000-0000-4000-8000-000000000001";

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getCheckout.mockResolvedValue({
    addonId,
    membershipId: "10000000-0000-4000-8000-000000000001",
    sessionId: "cs_addon_open",
  });
  mocks.retrieveSession.mockResolvedValue({
    id: "cs_addon_open",
    status: "open",
  });
  mocks.expireSession.mockResolvedValue({
    id: "cs_addon_open",
    status: "expired",
  });
  mocks.cancelCheckout.mockResolvedValue(true);
});

describe("Bread Club add-on Checkout cancellation", () => {
  it("expires Stripe before releasing add-on inventory", async () => {
    const response = await GET(
      new Request(
        `https://www.landlsourdough.com/api/bread-club/cancel-addon-checkout?addon_id=${addonId}&token=secret`,
      ),
    );

    expect(response.status).toBe(307);
    expect(mocks.expireSession).toHaveBeenCalledWith("cs_addon_open");
    expect(mocks.cancelCheckout).toHaveBeenCalledWith(
      addonId,
      "secret",
      "cs_addon_open",
    );
    expect(mocks.expireSession.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.cancelCheckout.mock.invocationCallOrder[0],
    );
  });

  it("does not release inventory for a completed payment", async () => {
    mocks.retrieveSession.mockResolvedValue({
      id: "cs_addon_open",
      status: "complete",
    });

    const response = await GET(
      new Request(
        `https://www.landlsourdough.com/api/bread-club/cancel-addon-checkout?addon_id=${addonId}&token=secret`,
      ),
    );

    expect(mocks.expireSession).not.toHaveBeenCalled();
    expect(mocks.cancelCheckout).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain(
      "/bread-club/manage?addon=success",
    );
  });
});
