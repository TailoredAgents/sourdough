import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const daily = readFileSync("src/lib/bread-club/daily.ts", "utf8");

describe("Bread Club daily job contract", () => {
  it("uses the unambiguous fulfillment order relationship", () => {
    expect(daily).toContain(
      "orders!bread_club_fulfillments_order_id_fkey(status)",
    );
  });

  it("claims stable keys before reminders, credits, and Friday summaries", () => {
    expect(daily).toContain("credit-invoice-item:${credit.id}");
    expect(daily).toContain("selection-reminder:${fulfillment.id}");
    expect(daily).toContain("friday-summary:${localDateKey(now)}");
    expect(daily).toContain('supabase.rpc("claim_bread_club_job"');
    expect(daily).toContain('supabase.rpc("finish_bread_club_job"');
    expect(daily).toContain("if (!claimToken)");
  });

  it("retries and reports pending Stripe provider changes", () => {
    expect(daily).toContain("reconcilePendingBreadClubProviderChanges");
    expect(daily).toContain("providerChangesSucceeded");
    expect(daily).toContain("providerChangesDeferred");
    expect(daily).toContain("Provider sync ${error}");
    expect(daily).toContain("provider_sync_required");
    expect(daily).toContain("!membership.provider_sync_required");

    const providerSync = daily.lastIndexOf(
      "await reconcilePendingBreadClubProviderChanges()",
    );
    const memberships = daily.lastIndexOf(
      "await reconcileMemberships(report, now)",
    );
    const canceledCredits = daily.lastIndexOf(
      "await reconcileCanceledBreadClubCreditRefunds(now)",
    );
    const pendingRefunds = daily.lastIndexOf(
      "await reconcileBreadClubPendingRefunds()",
    );
    expect(providerSync).toBeGreaterThan(-1);
    expect(providerSync).toBeLessThan(memberships);
    expect(memberships).toBeLessThan(canceledCredits);
    expect(canceledCredits).toBeLessThan(pendingRefunds);
    expect(daily).toContain('refund.state === "refunded"');
    expect(daily).toContain("refundsReconciled");
    expect(daily).toContain("refundsDeferred");
  });

  it("maps Stripe cancellation before same-run credit refund recovery", () => {
    expect(daily).toContain('subscription.status === "canceled"');
    expect(daily).toContain('status === "canceled" ||');
    expect(daily).toContain("canceled_at: details.canceledAt");
  });
});
