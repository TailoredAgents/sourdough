import { describe, expect, it } from "vitest";
import { getAdminMessageStatusActions } from "./admin-message-workflow";

describe("admin message workflow actions", () => {
  it("shows only useful next actions for open requests", () => {
    expect(getAdminMessageStatusActions("new")).toEqual([
      {
        label: "Working on it",
        status: "in_progress",
        variant: "secondary",
      },
      {
        label: "Mark handled",
        status: "handled",
        variant: "primary",
      },
      {
        label: "Close",
        status: "closed",
        variant: "ghost",
      },
    ]);
    expect(getAdminMessageStatusActions("in_progress")).toEqual([
      {
        label: "Mark handled",
        status: "handled",
        variant: "primary",
      },
      {
        label: "Close",
        status: "closed",
        variant: "ghost",
      },
    ]);
  });

  it("keeps reopen actions available for handled and closed requests", () => {
    expect(getAdminMessageStatusActions("handled")[0]).toEqual({
      label: "Reopen",
      status: "in_progress",
      variant: "secondary",
    });
    expect(getAdminMessageStatusActions("closed")).toEqual([
      {
        label: "Reopen",
        status: "in_progress",
        variant: "secondary",
      },
    ]);
  });
});
