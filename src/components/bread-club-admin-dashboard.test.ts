import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BreadClubAdminData } from "@/lib/bread-club/admin";
import { BreadClubAdminDashboard } from "./bread-club-admin-dashboard";

const planProduct = {
  id: "20000000-0000-4000-8000-000000000001",
  name: "Classic Country Loaf",
  description: "A dependable loaf.",
  imageUrl: null,
  imageStyle: "from-stone-100 to-amber-100",
  ingredients: ["Flour", "Water", "Salt"],
  allergens: ["Wheat"],
  priceCents: 1200,
  guaranteed: true,
  estimatedIngredientCostCents: 300,
};

const data: BreadClubAdminData = {
  publicEnabled: false,
  settings: {
    maxWeeklyLoafSlots: 10,
    skipLimitPerCycle: 1,
    rolloverCreditDays: 60,
    taxStatus: "pending",
    webhookEndpointId: "we_123",
    portalConfigurationId: "bpc_123",
  },
  stripeReady: {
    plans: true,
    delivery: true,
    webhook: true,
    portal: true,
  },
  metrics: {
    activeMembers: 1,
    recurringRevenueCents: 7200,
    paymentFailures: 0,
    rolloverLoaves: 1,
    rolloverDeliveryLiabilityCents: 500,
    nextSundayLoafSlots: 1,
    nextSundayStops: 1,
  },
  nextSunday: {
    label: "Sunday, August 2, 3:00 PM-6:00 PM",
    production: [
      { productName: "Classic Country Loaf", quantity: 1 },
    ],
  },
  urgentIssues: [
    "Georgia sales-tax treatment is still pending. Keep public enrollment disabled.",
  ],
  members: [
    {
      id: "30000000-0000-4000-8000-000000000001",
      status: "active",
      customerName: "Bread Club Customer",
      customerEmail: "member@example.com",
      customerPhone: "4045550100",
      plan: {
        id: "10000000-0000-4000-8000-000000000001",
        slug: "classic",
        name: "Classic Club",
        description: "One loaf each Sunday.",
        priceCents: 4400,
        loavesPerWeek: 1,
        active: true,
        sortOrder: 10,
        stripeProductId: "prod_classic",
        stripePriceId: "price_classic",
        stripePriceCents: 4400,
        stripeLookupKey: "bread_club_classic_4week_v1",
        eligibleProducts: [planProduct],
      },
      routeFeeCents: 700,
      routeBandKey: "11-20",
      deliveryAddress: {
        line1: "123 Main Street",
        line2: "",
        city: "Canton",
        state: "GA",
        postalCode: "30114",
      },
      deliveryInstructions: "Leave at the front door.",
      cancelAtPeriodEnd: false,
      firstDeliveryAt: "2026-08-02T19:00:00.000Z",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      currentCycle: {
        id: "40000000-0000-4000-8000-000000000001",
        cycleNumber: 1,
        status: "paid",
        periodStart: "2026-07-27T12:00:00.000Z",
        periodEnd: "2026-08-24T12:00:00.000Z",
        skipCount: 0,
        totalCents: 7200,
      },
      fulfillments: Array.from({ length: 4 }, (_, index) => ({
        id: `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        status: "scheduled" as const,
        weeklyMenuId: `60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        weeklyMenuName: `Sunday ${index + 1}`,
        cutoffAt: "2026-07-31T04:00:00.000Z",
        deliveryWindowId: `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        deliveryLabel: `Sunday delivery ${index + 1}`,
        deliveryStartsAt: `2026-08-${String(2 + index * 7).padStart(2, "0")}T19:00:00.000Z`,
        selection: [{ productId: planProduct.id, quantity: 1 }],
        items: [
          {
            productId: planProduct.id,
            productName: planProduct.name,
            quantity: 1,
          },
        ],
        availableProducts: [
          {
            id: planProduct.id,
            name: planProduct.name,
            remainingQuantity: 10,
            unavailable: false,
          },
        ],
        availableAddons: [],
      })),
      credits: [
        {
          id: "80000000-0000-4000-8000-000000000001",
          quantity: 1,
          deliveryFeeCreditCents: 500,
          status: "available",
          expiresAt: "2026-09-30T12:00:00.000Z",
        },
      ],
      createdAt: "2026-07-27T12:00:00.000Z",
      stripeInvoiceId: "in_123",
      providerSyncRequired: false,
      providerSyncError: null,
      providerSyncAttemptedAt: null,
      lastPaymentFailureAt: null,
      estimatedContributionCents: 2500,
      estimatedIngredientCostCents: 1200,
      estimatedStripeFeeCents: 289,
    },
  ],
};

describe("Bread Club admin display", () => {
  it("shows launch risk, production totals, member timeline, and owner actions", () => {
    const html = renderToStaticMarkup(
      React.createElement(BreadClubAdminDashboard, {
        initialData: data,
      }),
    );

    expect(html).toContain("Sunday Bread Club");
    expect(html).toContain("Public enrollment:");
    expect(html).toContain("Disabled");
    expect(html).toContain("Georgia sales-tax treatment is still pending");
    expect(html).toContain("1 / 10");
    expect(html).toContain("Bread Club Customer");
    expect(html).toContain("Four-Sunday timeline");
    expect(html).toContain("Classic Country Loaf");
    expect(html).toContain("Resend account link");
    expect(html).toContain("Stop future renewals");
    expect(html).toContain("Refund current cycle");
    expect(html).toContain("Estimated plan contribution");
    expect(html).toContain("Print Friday bake sheet");
  });

  it("makes a saved Stripe synchronization problem visible", () => {
    const providerSyncData = structuredClone(data);
    providerSyncData.members[0].providerSyncRequired = true;
    providerSyncData.members[0].providerSyncError =
      "Stripe temporarily rejected the delivery update.";
    providerSyncData.members[0].providerSyncAttemptedAt =
      "2026-08-02T18:00:00.000Z";

    const html = renderToStaticMarkup(
      React.createElement(BreadClubAdminDashboard, {
        initialData: providerSyncData,
      }),
    );

    expect(html).toContain("Saved change is waiting on Stripe");
    expect(html).toContain(
      "Stripe temporarily rejected the delivery update.",
    );
    expect(html).toContain("Last attempted");
  });
});
