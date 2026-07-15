export type AdminMessageStatusAction = {
  label: string;
  status: string;
  variant?: "primary" | "secondary" | "ghost";
};

export function getAdminMessageStatusActions(
  status: string,
): AdminMessageStatusAction[] {
  switch (status) {
    case "new":
      return [
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
      ];
    case "in_progress":
      return [
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
      ];
    case "handled":
      return [
        {
          label: "Reopen",
          status: "in_progress",
          variant: "secondary",
        },
        {
          label: "Close",
          status: "closed",
          variant: "ghost",
        },
      ];
    case "closed":
      return [
        {
          label: "Reopen",
          status: "in_progress",
          variant: "secondary",
        },
      ];
    default:
      return [
        {
          label: "Mark handled",
          status: "handled",
          variant: "primary",
        },
      ];
  }
}
