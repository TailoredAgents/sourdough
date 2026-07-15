export type AdminEmailTestResult = {
  ok: true;
  to: string;
  ownerAlertRecipients: string[];
};

export function extractAdminEmailTestResult(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const result = payload as {
    ok?: unknown;
    to?: unknown;
    ownerAlertRecipients?: unknown;
  };

  if (
    result.ok !== true ||
    typeof result.to !== "string" ||
    !Array.isArray(result.ownerAlertRecipients) ||
    !result.ownerAlertRecipients.every((recipient) => typeof recipient === "string")
  ) {
    return null;
  }

  return result as AdminEmailTestResult;
}

export function summarizeAdminEmailTest(result: AdminEmailTestResult) {
  const ownerAlertCount = result.ownerAlertRecipients.length;
  return ownerAlertCount
    ? `Test email sent to ${result.to}; owner alert checked for ${ownerAlertCount} recipient${ownerAlertCount === 1 ? "" : "s"}.`
    : `Test email sent to ${result.to}; no owner alert recipients are configured.`;
}
