import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPendingCheckoutOrder,
  markCheckoutSessionPaid,
} from "./order-records";
import type { CheckoutRequest, MenuProduct } from "./types";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  insertedCustomers: [] as unknown[],
  insertedOrders: [] as unknown[],
  insertedItems: [] as unknown[],
  updatedOrders: [] as unknown[],
}));

vi.mock("./supabase", () => ({
  getSupabaseAdminClient: () => ({
    from: mocks.from,
    rpc: mocks.rpc,
  }),
}));

const product: MenuProduct = {
  id: "00000000-0000-4000-8000-000000000001",
  productId: "00000000-0000-4000-8000-000000000001",
  name: "Classic Country Loaf",
  category: "bread",
  description: "A naturally leavened loaf.",
  ingredients: ["Flour", "Water", "Salt"],
  allergens: ["Wheat"],
  priceCents: 1200,
  stripeProductId: "prod_123",
  stripePriceId: "price_123",
  stripePriceCents: 1200,
  stripeSyncedAt: "2026-07-22T12:00:00.000Z",
  imageUrl: "/images/products/classic-country-loaf.webp",
  imageStyle: "from-stone-100 to-amber-100",
  active: true,
  availableQuantity: 10,
  soldQuantity: 0,
  remainingQuantity: 10,
};

const checkout: CheckoutRequest = {
  weeklyMenuId: "11111111-1111-4111-8111-111111111111",
  cart: [{ productId: product.id, quantity: 2 }],
  customer: {
    name: "Same Week Customer",
    email: "customer@example.com",
    phone: "4045550100",
  },
  address: {
    line1: "123 Main Street",
    line2: "",
    city: "Canton",
    state: "GA",
    postalCode: "30114",
  },
  deliveryWindowId: "22222222-2222-4222-8222-222222222222",
  deliveryInstructions: "Leave by the front door.",
  notes: "Please slice if possible.",
  nextWeekOk: true,
  acknowledgedTerms: true,
};

function setupCreateOrderSupabaseMock() {
  mocks.from.mockImplementation((table: string) => {
    if (table === "customers") {
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        }),
        insert: (row: unknown) => {
          mocks.insertedCustomers.push(row);
          return {
            select: () => ({
              single: async () => ({ data: { id: "customer-id" }, error: null }),
            }),
          };
        },
      };
    }

    if (table === "orders") {
      return {
        insert: (row: unknown) => {
          mocks.insertedOrders.push(row);
          return {
            select: () => ({
              single: async () => ({ data: { id: "order-id" }, error: null }),
            }),
          };
        },
        update: (row: unknown) => {
          mocks.updatedOrders.push(row);
          return {
            eq: () => ({ error: null }),
          };
        },
        delete: () => ({
          eq: () => ({ error: null }),
        }),
      };
    }

    if (table === "order_items") {
      return {
        insert: (rows: unknown[]) => {
          mocks.insertedItems.push(...rows);
          return { error: null };
        },
      };
    }

    throw new Error(`Unexpected table ${table}`);
  });
}

function setupPaidApprovalSupabaseMock() {
  mocks.from.mockImplementation((table: string) => {
    if (table === "orders") {
      return {
        update: (row: unknown) => {
          mocks.updatedOrders.push(row);
          return {
            eq: (_column: string, value: string) => ({
              eq: (_statusColumn: string, status: string) => ({
                select: async () =>
                  status === "pending_payment"
                    ? { data: [], error: null }
                    : {
                        data: [
                          {
                            id: "order-id",
                            customer_id: "customer-id",
                            delivery_window_id:
                              "22222222-2222-4222-8222-222222222222",
                            delivery_address: checkout.address,
                            notes: checkout.notes,
                            stripe_checkout_session_id: value,
                          },
                        ],
                        error: null,
                      },
              }),
            }),
          };
        },
      };
    }

    if (table === "customers") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                name: checkout.customer.name,
                email: checkout.customer.email,
                phone: checkout.customer.phone,
              },
            }),
          }),
        }),
      };
    }

    if (table === "delivery_windows") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { label: "Thursday (request)" } }),
          }),
        }),
      };
    }

    if (table === "order_items") {
      return {
        select: () => ({
          eq: () => ({
            data: [{ quantity: 2, products: { name: product.name } }],
          }),
        }),
      };
    }

    throw new Error(`Unexpected table ${table}`);
  });
}

beforeEach(() => {
  mocks.from.mockReset();
  mocks.rpc.mockReset();
  mocks.insertedCustomers.length = 0;
  mocks.insertedOrders.length = 0;
  mocks.insertedItems.length = 0;
  mocks.updatedOrders.length = 0;
});

describe("same-week approval order records", () => {
  it("persists approval checkout orders without reserving inventory first", async () => {
    setupCreateOrderSupabaseMock();

    const order = await createPendingCheckoutOrder({
      approvalMode: "after_cutoff",
      checkout,
      deliveryCheck: {
        eligible: true,
        needsReview: false,
        miles: 4.2,
        message: "30114 is in our local delivery area.",
        feeCents: 600,
        postalCode: "30114",
        allowedPostalCodes: ["30114"],
      },
      deliveryWindowId: checkout.deliveryWindowId,
      items: [{ ...product, quantity: 2 }],
      reserveInventory: false,
    });

    expect(order).toMatchObject({
      id: "order-id",
      approvalMode: "after_cutoff",
      subtotalCents: 2400,
      deliveryFeeCents: 600,
      totalCents: 3000,
      orderSummary: "2 x Classic Country Loaf",
    });
    expect(mocks.insertedOrders[0]).toMatchObject({
      status: "pending_approval_payment",
      next_week_ok: true,
      approval_mode: "after_cutoff",
      delivery_window_id: checkout.deliveryWindowId,
      notes: checkout.notes,
      delivery_instructions: checkout.deliveryInstructions,
      delivery_address: expect.objectContaining({
        email: "customer@example.com",
        phone: "4045550100",
      }),
    });
    expect(mocks.insertedItems).toEqual([
      {
        order_id: "order-id",
        product_id: product.id,
        quantity: 2,
        unit_price_cents: 1200,
      },
    ]);
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "reserve_order_inventory",
      expect.anything(),
    );
  });

  it("moves paid approval sessions into pending approval for admin review", async () => {
    setupPaidApprovalSupabaseMock();

    const paidOrder = await markCheckoutSessionPaid("cs_test_approval");

    expect(mocks.updatedOrders).toEqual([
      expect.objectContaining({ status: "paid" }),
      expect.objectContaining({ status: "pending_approval" }),
    ]);
    expect(paidOrder).toMatchObject({
      orderId: "order-id",
      status: "pending_approval",
      customerName: "Same Week Customer",
      customerEmail: "customer@example.com",
      deliveryWindow: "Thursday (request)",
      orderSummary: "2 x Classic Country Loaf",
    });
  });
});
