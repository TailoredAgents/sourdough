import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleBreadClubStripeEvent,
  reconcileBreadClubSubscriptionCheckout,
} from "./webhook";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  claimStripeEvent: vi.fn(),
  finishStripeEvent: vi.fn(),
  claimJob: vi.fn(),
  finishJob: vi.fn(),
  from: vi.fn(),
  findBreadClubCycleByInvoiceId: vi.fn(),
  findPendingCycleForMembership: vi.fn(),
  activateBreadClubCycleForInvoice: vi.fn(),
  prepareNextBreadClubCycle: vi.fn(),
  attachStripeSubscriptionCheckout: vi.fn(),
  recordBreadClubCheckoutCompleted: vi.fn(),
  releaseBreadClubPendingCycle: vi.fn(),
  expireBreadClubCheckoutSession: vi.fn(),
  markBreadClubInvoiceFailed: vi.fn(),
  markInvoiceDeliveryCreditsApplied: vi.fn(),
  refundBreadClubUnusedCredits: vi.fn(),
  sendBreadClubWelcome: vi.fn(),
  sendBreadClubRenewal: vi.fn(),
  sendBreadClubOwnerAlert: vi.fn(),
  sendBreadClubPaymentFailure: vi.fn(),
  sendOwnerAlert: vi.fn(),
  completeBreadClubAddonCheckout: vi.fn(),
  expireBreadClubAddonCheckout: vi.fn(),
  retrieveSubscription: vi.fn(),
  membershipSelect: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdminClient: () => ({
    rpc: mocks.rpc,
    from: mocks.from,
  }),
}));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    subscriptions: {
      retrieve: mocks.retrieveSubscription,
    },
  }),
}));
vi.mock("@/lib/owner-alerts", () => ({
  sendOwnerAlert: mocks.sendOwnerAlert,
}));
vi.mock("./records", () => ({
  findBreadClubCycleByInvoiceId:
    mocks.findBreadClubCycleByInvoiceId,
  findPendingCycleForMembership:
    mocks.findPendingCycleForMembership,
  activateBreadClubCycleForInvoice:
    mocks.activateBreadClubCycleForInvoice,
  prepareNextBreadClubCycle: mocks.prepareNextBreadClubCycle,
  attachStripeSubscriptionCheckout:
    mocks.attachStripeSubscriptionCheckout,
  recordBreadClubCheckoutCompleted:
    mocks.recordBreadClubCheckoutCompleted,
  releaseBreadClubPendingCycle:
    mocks.releaseBreadClubPendingCycle,
  expireBreadClubCheckoutSession:
    mocks.expireBreadClubCheckoutSession,
  markBreadClubInvoiceFailed:
    mocks.markBreadClubInvoiceFailed,
}));
vi.mock("./billing", () => ({
  markInvoiceDeliveryCreditsApplied:
    mocks.markInvoiceDeliveryCreditsApplied,
  refundBreadClubUnusedCredits:
    mocks.refundBreadClubUnusedCredits,
}));
vi.mock("./emails", () => ({
  sendBreadClubWelcome: mocks.sendBreadClubWelcome,
  sendBreadClubRenewal: mocks.sendBreadClubRenewal,
  sendBreadClubOwnerAlert: mocks.sendBreadClubOwnerAlert,
  sendBreadClubPaymentFailure: mocks.sendBreadClubPaymentFailure,
}));
vi.mock("./member-actions", () => ({
  completeBreadClubAddonCheckout:
    mocks.completeBreadClubAddonCheckout,
  expireBreadClubAddonCheckout:
    mocks.expireBreadClubAddonCheckout,
}));
vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return {
    ...actual,
    getSiteUrl: () => "https://www.landlsourdough.com",
  };
});

const membershipId = "10000000-0000-4000-8000-000000000001";
const cycleId = "20000000-0000-4000-8000-000000000001";

function invoicePaidEvent(id = "evt_invoice_paid") {
  return {
    id,
    type: "invoice.paid",
    data: {
      object: {
        id: "in_bread_club",
        amount_paid: 8000,
        parent: {
          subscription_details: {
            metadata: {
              bread_club_membership_id: membershipId,
            },
          },
        },
        lines: { data: [] },
        total_taxes: [],
        status_transitions: { paid_at: 1785153600 },
      },
    },
  } as unknown as Stripe.Event;
}

function invoiceUpcomingEvent(id = "evt_invoice_upcoming") {
  return {
    id,
    type: "invoice.upcoming",
    data: {
      object: {
        id: "in_upcoming",
        parent: {
          subscription_details: {
            metadata: {
              bread_club_membership_id: membershipId,
            },
          },
        },
      },
    },
  } as unknown as Stripe.Event;
}

function invoicePaymentFailedEvent(id = "evt_invoice_failed") {
  const event = invoicePaidEvent(id) as unknown as {
    type: string;
  } & Stripe.Event;
  event.type = "invoice.payment_failed";
  return event as Stripe.Event;
}

function subscriptionEvent(input: {
  id: string;
  type: "customer.subscription.updated" | "customer.subscription.deleted";
  cancelAtPeriodEnd: boolean;
}) {
  return {
    id: input.id,
    type: input.type,
    data: {
      object: {
        id: "sub_bread_club",
        status:
          input.type === "customer.subscription.deleted"
            ? "canceled"
            : "active",
        cancel_at_period_end: input.cancelAtPeriodEnd,
        canceled_at:
          input.type === "customer.subscription.deleted"
            ? 1787572800
            : null,
        metadata: {
          bread_club_membership_id: membershipId,
        },
        items: {
          data: [
            {
              id: "si_plan",
              current_period_end: 1787572800,
              price: {
                metadata: { bread_club_plan_id: planIdForMetadata() },
              },
            },
            {
              id: "si_delivery",
              current_period_end: 1787572800,
              price: {
                metadata: { bread_club_delivery_band: "11-20" },
              },
            },
          ],
        },
      },
    },
  } as unknown as Stripe.Event;
}

function paidCheckoutInvoice() {
  return {
    id: "in_checkout",
    status: "paid",
    amount_paid: 8000,
    total_taxes: [],
    status_transitions: { paid_at: 1785153600 },
    parent: {
      subscription_details: {
        metadata: {
          bread_club_membership_id: membershipId,
        },
      },
    },
  } as unknown as Stripe.Invoice;
}

function checkoutSubscription(
  latestInvoice: Stripe.Invoice | null = paidCheckoutInvoice(),
) {
  return {
    id: "sub_bread_club",
    metadata: {
      checkout_kind: "bread_club_subscription",
      bread_club_membership_id: membershipId,
    },
    items: {
      data: [
        {
          id: "si_plan",
          current_period_end: 1787572800,
          price: {
            metadata: { bread_club_plan_id: planIdForMetadata() },
          },
        },
        {
          id: "si_delivery",
          current_period_end: 1787572800,
          price: {
            metadata: { bread_club_delivery_band: "11-20" },
          },
        },
      ],
    },
    latest_invoice: latestInvoice,
  } as unknown as Stripe.Subscription;
}

function subscriptionCheckoutSession(
  paymentStatus: Stripe.Checkout.Session.PaymentStatus,
) {
  return {
    id: "cs_bread_club",
    mode: "subscription",
    status: "complete",
    payment_status: paymentStatus,
    customer: "cus_bread_club",
    subscription: "sub_bread_club",
    metadata: {
      checkout_kind: "bread_club_subscription",
      bread_club_membership_id: membershipId,
      bread_club_cycle_id: cycleId,
    },
  } as unknown as Stripe.Checkout.Session;
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  process.env.BAKERY_EMAIL = "owner@example.com";
  mocks.claimStripeEvent.mockResolvedValue({
    data: "30000000-0000-4000-8000-000000000001",
    error: null,
  });
  mocks.finishStripeEvent.mockResolvedValue({ data: true, error: null });
  mocks.claimJob.mockResolvedValue({
    data: "40000000-0000-4000-8000-000000000001",
    error: null,
  });
  mocks.finishJob.mockResolvedValue({ data: true, error: null });
  mocks.rpc.mockImplementation((name: string) => {
    if (name === "claim_stripe_event") return mocks.claimStripeEvent();
    if (name === "finish_stripe_event") return mocks.finishStripeEvent();
    if (name === "claim_bread_club_job") return mocks.claimJob();
    if (name === "finish_bread_club_job") return mocks.finishJob();
    throw new Error(`Unexpected RPC ${name}`);
  });
  mocks.findBreadClubCycleByInvoiceId.mockResolvedValue(null);
  mocks.findPendingCycleForMembership.mockResolvedValue({
    id: cycleId,
    cycleNumber: 1,
  });
  mocks.activateBreadClubCycleForInvoice.mockResolvedValue(undefined);
  mocks.markInvoiceDeliveryCreditsApplied.mockResolvedValue(undefined);
  mocks.from.mockImplementation((table: string) => {
    if (table === "bread_club_memberships") {
      return {
        update: () => ({
          eq: async () => ({ error: null }),
        }),
        select: (columns: string) => {
          mocks.membershipSelect(columns);
          return {
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: membershipId,
                  status: "active",
                  cancel_at_period_end: false,
                  customers: {
                    name: "Bread Club Customer",
                    email: "member@example.com",
                  },
                  bread_club_plans: { name: "Variety Club" },
                  first_delivery_at: "2026-08-02T19:00:00.000Z",
                },
                error: null,
              }),
            }),
          };
        },
      };
    }
    if (table === "bread_club_cycles") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { cycle_number: 1, total_cents: 8000 },
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === "bread_club_fulfillments") {
      return {
        select: () => ({
          eq: () => ({
            order: async () => ({
              data: Array.from({ length: 4 }, (_, index) => ({
                order_id: `order-${index + 1}`,
                delivery_windows: {
                  label: `Sunday delivery ${index + 1}`,
                  starts_at: "2026-08-02T19:00:00.000Z",
                },
              })),
              error: null,
            }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
});

describe("Bread Club Stripe webhook integration", () => {
  it.each(["paid", "no_payment_required"] as const)(
    "activates a completed %s subscription Checkout",
    async (paymentStatus) => {
      mocks.retrieveSubscription.mockResolvedValue(checkoutSubscription());

      await expect(
        reconcileBreadClubSubscriptionCheckout(
          subscriptionCheckoutSession(paymentStatus),
        ),
      ).resolves.toEqual(
        expect.objectContaining({
          membershipId,
          cycleId,
          checkoutRecorded: true,
          cycleState: "activated",
        }),
      );

      expect(mocks.attachStripeSubscriptionCheckout).toHaveBeenCalledWith(
        membershipId,
        "cs_bread_club",
      );
      expect(mocks.recordBreadClubCheckoutCompleted).toHaveBeenCalledWith(
        expect.objectContaining({
          membershipId,
          stripeSubscriptionId: "sub_bread_club",
          planSubscriptionItemId: "si_plan",
          deliverySubscriptionItemId: "si_delivery",
        }),
      );
      expect(mocks.activateBreadClubCycleForInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          membershipId,
          cycleId,
          invoiceId: "in_checkout",
        }),
      );
    },
  );

  it("idempotently reapplies a completed paid Checkout without notifying twice", async () => {
    mocks.retrieveSubscription.mockResolvedValue(checkoutSubscription());
    mocks.findBreadClubCycleByInvoiceId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: cycleId,
        membershipId,
        cycleNumber: 1,
        status: "paid",
      });
    mocks.claimJob
      .mockResolvedValueOnce({
        data: "40000000-0000-4000-8000-000000000001",
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });

    await expect(
      reconcileBreadClubSubscriptionCheckout(
        subscriptionCheckoutSession("paid"),
      ),
    ).resolves.toEqual(expect.objectContaining({ cycleState: "activated" }));
    await expect(
      reconcileBreadClubSubscriptionCheckout(
        subscriptionCheckoutSession("paid"),
      ),
    ).resolves.toEqual(
      expect.objectContaining({ cycleState: "already_activated" }),
    );

    expect(mocks.recordBreadClubCheckoutCompleted).toHaveBeenCalledTimes(2);
    expect(mocks.activateBreadClubCycleForInvoice).toHaveBeenCalledTimes(2);
    expect(mocks.sendBreadClubWelcome).toHaveBeenCalledTimes(1);
    expect(mocks.sendBreadClubOwnerAlert).toHaveBeenCalledTimes(1);
    expect(mocks.sendOwnerAlert).toHaveBeenCalledTimes(1);
  });

  it("records but does not fulfill a completed unpaid subscription Checkout", async () => {
    mocks.retrieveSubscription.mockResolvedValue(checkoutSubscription());

    await expect(
      reconcileBreadClubSubscriptionCheckout(
        subscriptionCheckoutSession("unpaid"),
      ),
    ).resolves.toEqual(
      expect.objectContaining({ cycleState: "awaiting_payment" }),
    );

    expect(mocks.attachStripeSubscriptionCheckout).toHaveBeenCalled();
    expect(mocks.recordBreadClubCheckoutCompleted).toHaveBeenCalled();
    expect(mocks.findBreadClubCycleByInvoiceId).not.toHaveBeenCalled();
    expect(mocks.findPendingCycleForMembership).not.toHaveBeenCalled();
    expect(mocks.activateBreadClubCycleForInvoice).not.toHaveBeenCalled();
    expect(mocks.sendBreadClubWelcome).not.toHaveBeenCalled();
  });

  it("provisions a paid cycle and sends member and owner communication", async () => {
    await expect(
      handleBreadClubStripeEvent(invoicePaidEvent()),
    ).resolves.toBe(true);

    expect(mocks.rpc).toHaveBeenCalledWith("claim_stripe_event", {
      p_event_id: "evt_invoice_paid",
      p_event_type: "invoice.paid",
      p_object_id: "in_bread_club",
    });
    expect(mocks.activateBreadClubCycleForInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        membershipId,
        cycleId,
        invoiceId: "in_bread_club",
        amountPaidCents: 8000,
      }),
    );
    expect(mocks.membershipSelect).toHaveBeenCalledWith(
      expect.stringContaining(
        "bread_club_plans!bread_club_memberships_plan_id_fkey(name)",
      ),
    );
    expect(mocks.rpc).toHaveBeenCalledWith("claim_bread_club_job", {
      p_job_key: `paid-cycle-notification:${cycleId}`,
      p_job_type: "paid_cycle_notification",
      p_membership_id: membershipId,
      p_payload: { cycle_id: cycleId },
    });
    expect(mocks.markInvoiceDeliveryCreditsApplied).toHaveBeenCalled();
    expect(mocks.sendBreadClubWelcome).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "member@example.com",
        planName: "Variety Club",
        recurringTotalCents: 8000,
        sundayLabels: [
          "Sunday delivery 1",
          "Sunday delivery 2",
          "Sunday delivery 3",
          "Sunday delivery 4",
        ],
      }),
    );
    expect(mocks.sendBreadClubOwnerAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "owner@example.com",
        customerName: "Bread Club Customer",
      }),
    );
    expect(mocks.sendOwnerAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "order",
        customerName: "Bread Club Customer",
        orderSummary: "Variety Club, four Sunday deliveries",
        orderId: "order-1",
      }),
    );
  });

  it.each(["refund_pending", "refunded"])(
    "does not reactivate or notify a %s cycle when its paid invoice is replayed",
    async (status) => {
      mocks.findBreadClubCycleByInvoiceId.mockResolvedValue({
        id: cycleId,
        membershipId,
        cycleNumber: 1,
        status,
      });
      const event = invoicePaidEvent(`evt_${status}_invoice_replayed`);

      await expect(handleBreadClubStripeEvent(event)).resolves.toBe(true);

      expect(mocks.markInvoiceDeliveryCreditsApplied).toHaveBeenCalledWith(
        membershipId,
        event.data.object,
      );
      expect(mocks.findPendingCycleForMembership).not.toHaveBeenCalled();
      expect(mocks.prepareNextBreadClubCycle).not.toHaveBeenCalled();
      expect(mocks.activateBreadClubCycleForInvoice).not.toHaveBeenCalled();
      expect(mocks.claimJob).not.toHaveBeenCalled();
      expect(mocks.sendBreadClubWelcome).not.toHaveBeenCalled();
      expect(mocks.sendBreadClubRenewal).not.toHaveBeenCalled();
    },
  );

  it("fails closed for a canceled cycle whose invoice is reported paid", async () => {
    mocks.findBreadClubCycleByInvoiceId.mockResolvedValue({
      id: cycleId,
      membershipId,
      cycleNumber: 1,
      status: "canceled",
    });

    await expect(
      handleBreadClubStripeEvent(
        invoicePaidEvent("evt_canceled_invoice_paid"),
      ),
    ).rejects.toThrow(
      `Bread Club cycle ${cycleId} is canceled, but Stripe reported invoice in_bread_club as paid. Manual reconciliation is required.`,
    );

    expect(mocks.findPendingCycleForMembership).not.toHaveBeenCalled();
    expect(mocks.prepareNextBreadClubCycle).not.toHaveBeenCalled();
    expect(mocks.activateBreadClubCycleForInvoice).not.toHaveBeenCalled();
    expect(mocks.markInvoiceDeliveryCreditsApplied).not.toHaveBeenCalled();
    expect(mocks.claimJob).not.toHaveBeenCalled();
  });

  it("does not repeat provisioning or email for a duplicate Stripe event", async () => {
    mocks.claimStripeEvent.mockResolvedValue({ data: null, error: null });
    await expect(
      handleBreadClubStripeEvent(invoicePaidEvent("evt_duplicate")),
    ).resolves.toBe(true);

    expect(mocks.activateBreadClubCycleForInvoice).not.toHaveBeenCalled();
    expect(mocks.sendBreadClubWelcome).not.toHaveBeenCalled();
    expect(mocks.sendBreadClubOwnerAlert).not.toHaveBeenCalled();
  });

  it("recovers an unattached expired subscription from signed Stripe metadata", async () => {
    const event = {
      id: "evt_subscription_checkout_expired",
      type: "checkout.session.expired",
      data: {
        object: {
          id: "cs_subscription_expired",
          metadata: {
            checkout_kind: "bread_club_subscription",
            bread_club_membership_id: membershipId,
            bread_club_cycle_id: cycleId,
          },
        },
      },
    } as unknown as Stripe.Event;

    await expect(handleBreadClubStripeEvent(event)).resolves.toBe(true);

    expect(mocks.expireBreadClubCheckoutSession).toHaveBeenCalledWith(
      "cs_subscription_expired",
      membershipId,
    );
  });

  it("recovers an unattached expired add-on from signed Stripe metadata", async () => {
    const addonId = "50000000-0000-4000-8000-000000000001";
    const event = {
      id: "evt_addon_checkout_expired",
      type: "checkout.session.expired",
      data: {
        object: {
          id: "cs_addon_expired",
          metadata: {
            checkout_kind: "bread_club_addon",
            bread_club_addon_id: addonId,
            bread_club_membership_id: membershipId,
          },
        },
      },
    } as unknown as Stripe.Event;

    await expect(handleBreadClubStripeEvent(event)).resolves.toBe(true);

    expect(mocks.expireBreadClubAddonCheckout).toHaveBeenCalledWith(
      "cs_addon_expired",
      addonId,
    );
  });

  it("sends paid-cycle communication once when different Stripe events race", async () => {
    mocks.claimJob
      .mockResolvedValueOnce({
        data: "40000000-0000-4000-8000-000000000001",
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });

    await handleBreadClubStripeEvent(
      invoicePaidEvent("evt_paid_notification_first"),
    );
    await handleBreadClubStripeEvent(
      invoicePaidEvent("evt_paid_notification_race"),
    );

    expect(mocks.sendBreadClubWelcome).toHaveBeenCalledTimes(1);
    expect(mocks.sendBreadClubOwnerAlert).toHaveBeenCalledTimes(1);
    expect(mocks.sendOwnerAlert).toHaveBeenCalledTimes(1);
  });

  it("handles invoice payment before Checkout completion through the idempotent activation boundary", async () => {
    mocks.findBreadClubCycleByInvoiceId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: cycleId,
        membershipId,
        cycleNumber: 1,
        status: "paid",
      });
    mocks.claimJob
      .mockResolvedValueOnce({
        data: "40000000-0000-4000-8000-000000000001",
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });
    await handleBreadClubStripeEvent(invoicePaidEvent("evt_out_of_order_paid"));
    mocks.findPendingCycleForMembership.mockResolvedValue(null);
    mocks.retrieveSubscription.mockResolvedValue(checkoutSubscription());

    const checkoutEvent = {
      id: "evt_out_of_order_checkout",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_bread_club",
          mode: "subscription",
          status: "complete",
          payment_status: "paid",
          customer: "cus_bread_club",
          subscription: "sub_bread_club",
          metadata: {
            checkout_kind: "bread_club_subscription",
            bread_club_membership_id: membershipId,
            bread_club_cycle_id: cycleId,
          },
        },
      },
    } as unknown as Stripe.Event;
    await expect(
      handleBreadClubStripeEvent(checkoutEvent),
    ).resolves.toBe(true);

    expect(mocks.recordBreadClubCheckoutCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        membershipId,
        sessionId: "cs_bread_club",
        stripeSubscriptionId: "sub_bread_club",
        planSubscriptionItemId: "si_plan",
        deliverySubscriptionItemId: "si_delivery",
      }),
    );
    expect(mocks.attachStripeSubscriptionCheckout).toHaveBeenCalledWith(
      membershipId,
      "cs_bread_club",
    );
    expect(
      mocks.attachStripeSubscriptionCheckout.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.recordBreadClubCheckoutCompleted.mock.invocationCallOrder[0],
    );
    expect(mocks.activateBreadClubCycleForInvoice).toHaveBeenCalledTimes(2);
  });

  it("prepares an active membership when Stripe announces its next invoice", async () => {
    mocks.prepareNextBreadClubCycle.mockResolvedValue({
      id: "next-cycle",
      cycleNumber: 2,
    });

    await expect(
      handleBreadClubStripeEvent(invoiceUpcomingEvent()),
    ).resolves.toBe(true);

    expect(mocks.prepareNextBreadClubCycle).toHaveBeenCalledWith(
      membershipId,
    );
  });

  it("does not reserve another cycle for a canceling membership", async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === "processed_stripe_events") {
        return {
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      if (table === "bread_club_memberships") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: membershipId,
                  status: "canceling",
                  cancel_at_period_end: true,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    await expect(
      handleBreadClubStripeEvent(
        invoiceUpcomingEvent("evt_canceling_upcoming"),
      ),
    ).resolves.toBe(true);

    expect(mocks.prepareNextBreadClubCycle).not.toHaveBeenCalled();
  });

  it("does not reserve another cycle while a provider change is pending", async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === "bread_club_memberships") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: membershipId,
                  status: "active",
                  cancel_at_period_end: false,
                  provider_sync_required: true,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    await expect(
      handleBreadClubStripeEvent(
        invoiceUpcomingEvent("evt_provider_sync_upcoming"),
      ),
    ).resolves.toBe(true);

    expect(mocks.prepareNextBreadClubCycle).not.toHaveBeenCalled();
  });

  it("releases an unpaid renewal when cancellation comes from Billing Portal", async () => {
    const event = subscriptionEvent({
      id: "evt_portal_cancel",
      type: "customer.subscription.updated",
      cancelAtPeriodEnd: true,
    });

    await expect(handleBreadClubStripeEvent(event)).resolves.toBe(true);

    expect(mocks.releaseBreadClubPendingCycle).toHaveBeenCalledWith(cycleId);
  });

  it("records failed renewal payment and sends the recovery message", async () => {
    await expect(
      handleBreadClubStripeEvent(invoicePaymentFailedEvent()),
    ).resolves.toBe(true);

    expect(mocks.markBreadClubInvoiceFailed).toHaveBeenCalledWith(
      membershipId,
      "in_bread_club",
    );
    expect(mocks.sendBreadClubPaymentFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "member@example.com",
        membershipId,
        eventKey: "stripe-event:evt_invoice_failed:payment-failure",
      }),
    );
  });

  it("releases unpaid reservations and refunds unused credits when Stripe ends a membership", async () => {
    const event = subscriptionEvent({
      id: "evt_subscription_deleted",
      type: "customer.subscription.deleted",
      cancelAtPeriodEnd: false,
    });

    await expect(handleBreadClubStripeEvent(event)).resolves.toBe(true);

    expect(mocks.releaseBreadClubPendingCycle).toHaveBeenCalledWith(cycleId);
    expect(mocks.refundBreadClubUnusedCredits).toHaveBeenCalledWith(
      membershipId,
    );
  });

  it("fails the deleted-subscription event when unused-credit refunds fail", async () => {
    mocks.refundBreadClubUnusedCredits.mockRejectedValue(
      new Error("Stripe refund is temporarily unavailable."),
    );
    const event = subscriptionEvent({
      id: "evt_subscription_deleted_refund_failure",
      type: "customer.subscription.deleted",
      cancelAtPeriodEnd: false,
    });

    await expect(handleBreadClubStripeEvent(event)).rejects.toThrow(
      "Stripe refund is temporarily unavailable.",
    );

    expect(mocks.rpc).toHaveBeenCalledWith(
      "finish_stripe_event",
      expect.objectContaining({
        p_event_id: "evt_subscription_deleted_refund_failure",
        p_status: "failed",
        p_error_message: "Stripe refund is temporarily unavailable.",
      }),
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "finish_stripe_event",
      expect.objectContaining({ p_status: "processed" }),
    );
  });
});

function planIdForMetadata() {
  return "10000000-0000-4000-8000-000000000002";
}
