import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const memberActions = readFileSync(
  "src/lib/bread-club/member-actions.ts",
  "utf8",
);

describe("Bread Club lifecycle source contract", () => {
  it("releases a prepared unpaid renewal when a member cancels", () => {
    const cancellation = memberActions.slice(
      memberActions.indexOf("export async function cancelBreadClubMembership"),
      memberActions.indexOf("type AddonItem"),
    );
    expect(cancellation).toContain("findPendingCycleForMembership");
    expect(cancellation).toContain("releaseBreadClubPendingCycle");
    expect(cancellation.indexOf("stripe.subscriptions.update")).toBeLessThan(
      cancellation.indexOf("releaseBreadClubPendingCycle"),
    );
  });

  it("locks delivery-address changes after the Thursday cutoff", () => {
    const addressChange = memberActions.slice(
      memberActions.indexOf("export async function updateBreadClubAddress"),
      memberActions.indexOf("export async function cancelBreadClubMembership"),
    );
    expect(addressChange).toContain("fulfillment.cutoffAt");
    expect(addressChange).toContain("This Sunday's route is already locked.");
  });
});
