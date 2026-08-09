import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentAdmin: vi.fn(),
  getCustomerMessagesPageData: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  getCurrentAdmin: mocks.getCurrentAdmin,
}));

vi.mock("@/lib/customer-messages", () => ({
  customerMessageReplySchema: { safeParse: vi.fn() },
  customerMessageStatusSchema: { safeParse: vi.fn() },
  getCustomerMessagesPageData: mocks.getCustomerMessagesPageData,
  sendCustomerMessageReply: vi.fn(),
  updateCustomerMessageStatus: vi.fn(),
}));

import { GET } from "./route";

beforeEach(() => {
  mocks.getCurrentAdmin.mockReset();
  mocks.getCustomerMessagesPageData.mockReset();
  mocks.getCurrentAdmin.mockResolvedValue({ email: "owner@example.com" });
});

describe("admin message pagination", () => {
  it("returns page metadata so the inbox can load every message", async () => {
    mocks.getCustomerMessagesPageData.mockResolvedValue({
      messages: [{ id: "message-101" }],
      hasMore: true,
      total: 201,
    });

    const response = await GET(
      new Request("https://www.landlsourdough.com/api/admin/messages?offset=100"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      messages: [{ id: "message-101" }],
      hasMore: true,
      total: 201,
    });
    expect(mocks.getCustomerMessagesPageData).toHaveBeenCalledWith({ offset: 100 });
  });

  it("rejects invalid page offsets instead of silently returning the first page", async () => {
    const response = await GET(
      new Request("https://www.landlsourdough.com/api/admin/messages?offset=-1"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Message page offset is invalid.",
    });
  });
});
