import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPendingCheckoutOrder,
  markCheckoutSessionPaid,
} from "./order-records";
import type { CheckoutRequest, MenuProduct } from "./types";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
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
  checkoutAttemptId: "33333333-3333-4333-8333-333333333333",
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

function setupPaidApprovalSupabaseMock() {
  mocks.rpc.mockResolvedValue({
    data: [
      {
        order_id: "order-id",
        next_status: "pending_approval",
        recovery_note: null,
      },
    ],
    error: null,
  });
  mocks.from.mockImplementation((table: string) => {
    if (table === "orders") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: "order-id",
                customer_id: "customer-id",
                delivery_window_id:
                  "22222222-2222-4222-8222-222222222222",
                delivery_address: checkout.address,
                notes: checkout.notes,
              },
              error: null,
            }),
          }),
        }),
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
});

describe("same-week approval order records", () => {
  it("persists approval checkout orders without reserving inventory first", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          order_id: "order-id",
          customer_id: "customer-id",
          subtotal_cents: 2400,
          delivery_fee_cents: 600,
          total_cents: 3000,
          checkout_cancel_token:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          checkout_expires_at: "2099-08-13T20:00:00.000Z",
        },
      ],
      error: null,
    });

    const order = await createPendingCheckoutOrder({
      approvalMode: "after_cutoff",
      checkout,
      checkoutRequestHash:
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      deliveryCheck: {
        eligible: true,
        preliminary: false,
        provider: "google_routes",
        providerStatus: "ok",
        needsReview: false,
        miles: 4.2,
        durationMinutes: 12,
        distanceMeters: 6759,
        distanceMiles: 4.2,
        pricingBand: "11-20",
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
    expect(mocks.rpc).toHaveBeenCalledWith(
      "create_storefront_checkout_order",
      expect.objectContaining({
        p_customer_name: checkout.customer.name,
        p_checkout_attempt_id: checkout.checkoutAttemptId,
        p_checkout_request_hash:
          "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        p_customer_email: "customer@example.com",
        p_customer_phone: checkout.customer.phone,
        p_delivery_window_id: checkout.deliveryWindowId,
        p_approval_mode: "after_cutoff",
        p_delivery_fee_cents: 600,
        p_delivery_instructions: checkout.deliveryInstructions,
        p_notes: checkout.notes,
        p_next_week_ok: true,
        p_items: [
          {
            product_id: product.id,
            quantity: 2,
            unit_price_cents: 1200,
          },
        ],
        p_reserve_inventory: false,
      }),
    );
    expect(mocks.rpc.mock.calls[0]?.[1].p_checkout_cancel_token).toMatch(
      /^[0-9a-f]{48}$/,
    );
  });

  it("moves paid approval sessions into pending approval for admin review", async () => {
    setupPaidApprovalSupabaseMock();

    const paidOrder = await markCheckoutSessionPaid("cs_test_approval", {
      currency: "usd",
      subtotalCents: 3000,
      taxCents: 210,
      totalCents: 3210,
    });

    expect(mocks.rpc).toHaveBeenCalledWith(
      "complete_storefront_checkout_payment",
      {
        p_session_id: "cs_test_approval",
        p_currency: "usd",
        p_subtotal_cents: 3000,
        p_tax_cents: 210,
        p_total_cents: 3210,
      },
    );
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
