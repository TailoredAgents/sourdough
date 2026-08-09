import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentAdmin: vi.fn(),
  getAdminOrdersData: vi.fn(),
  acceptApprovalOrder: vi.fn(),
  denyApprovalOrderWithRefund: vi.fn(),
  moveApprovalOrderToNextWeek: vi.fn(),
  updateAdminOrderStatus: vi.fn(),
  parseApprovalAction: vi.fn(),
  parseStatusUpdate: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  getCurrentAdmin: mocks.getCurrentAdmin,
}));

vi.mock("@/lib/order-admin", () => ({
  acceptApprovalOrder: mocks.acceptApprovalOrder,
  denyApprovalOrderWithRefund: mocks.denyApprovalOrderWithRefund,
  getAdminOrdersData: mocks.getAdminOrdersData,
  moveApprovalOrderToNextWeek: mocks.moveApprovalOrderToNextWeek,
  orderApprovalActionSchema: { safeParse: mocks.parseApprovalAction },
  orderStatusUpdateSchema: { safeParse: mocks.parseStatusUpdate },
  updateAdminOrderStatus: mocks.updateAdminOrderStatus,
}));

import { GET, PATCH } from "./route";

const weeklyMenuId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getCurrentAdmin.mockResolvedValue({ email: "owner@example.com" });
  mocks.getAdminOrdersData.mockResolvedValue([]);
  mocks.parseApprovalAction.mockReturnValue({ success: false });
  mocks.parseStatusUpdate.mockReturnValue({ success: false, error: { issues: [] } });
});

describe("admin orders API delivery-week scope", () => {
  it("loads up to 500 orders for a validated delivery week", async () => {
    mocks.getAdminOrdersData.mockResolvedValue([{ id: "scoped-order" }]);

    const response = await GET(
      new Request(
        `https://www.landlsourdough.com/api/admin/orders?weeklyMenuId=${weeklyMenuId}`,
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      orders: [{ id: "scoped-order" }],
    });
    expect(mocks.getAdminOrdersData).toHaveBeenCalledWith({
      weeklyMenuId,
      limit: 500,
    });
  });

  it("rejects an invalid delivery-week ID before querying orders", async () => {
    const response = await GET(
      new Request(
        "https://www.landlsourdough.com/api/admin/orders?weeklyMenuId=not-a-uuid",
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Delivery week must be a valid ID.",
    });
    expect(mocks.getAdminOrdersData).not.toHaveBeenCalled();
  });

  it("returns a fresh scoped snapshot after a PATCH", async () => {
    mocks.parseStatusUpdate.mockReturnValue({
      success: true,
      data: {
        id: "22222222-2222-4222-8222-222222222222",
        status: "delivered",
      },
    });
    mocks.updateAdminOrderStatus.mockResolvedValue({
      orders: [{ id: "global-order" }],
      completionNotification: "sent",
    });
    mocks.getAdminOrdersData.mockResolvedValue([{ id: "current-week-order" }]);

    const response = await PATCH(
      new Request(
        `https://www.landlsourdough.com/api/admin/orders?weeklyMenuId=${weeklyMenuId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: "22222222-2222-4222-8222-222222222222",
            status: "delivered",
          }),
        },
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      orders: [{ id: "current-week-order" }],
      completionNotification: "sent",
    });
    expect(mocks.getAdminOrdersData).toHaveBeenCalledWith({
      weeklyMenuId,
      limit: 500,
    });
    expect(mocks.updateAdminOrderStatus).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      "delivered",
      "owner@example.com",
      weeklyMenuId,
    );
  });

  it("rejects a hostile-origin mutation before it can command an order", async () => {
    const response = await PATCH(
      new Request(
        `https://www.landlsourdough.com/api/admin/orders?weeklyMenuId=${weeklyMenuId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            origin: "https://attacker.example",
          },
          body: JSON.stringify({
            id: "22222222-2222-4222-8222-222222222222",
            status: "delivered",
          }),
        },
      ),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "This action must be requested from the bakery site.",
    });
    expect(mocks.getCurrentAdmin).not.toHaveBeenCalled();
    expect(mocks.updateAdminOrderStatus).not.toHaveBeenCalled();
  });
});
