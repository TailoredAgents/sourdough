import { sendOwnerShortAlert } from "./email";

type OwnerAlertInput = {
  type: "order" | "request" | "inquiry";
  customerName: string;
  orderSummary?: string;
  notes?: string | null;
  orderId?: string;
  customerMessageId?: string;
};

function envFlagEnabled(name: string, fallback = false) {
  const value = process.env[name];
  if (!value) return fallback;
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function splitEmailList(value?: string) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getOwnerAlertRecipients() {
  return Array.from(
    new Set([
      ...splitEmailList(process.env.OWNER_ALERT_EMAIL),
      ...splitEmailList(process.env.OWNER_ALERT_SMS_EMAIL),
    ]),
  );
}

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

export function buildOwnerAlertMessage({
  customerName,
  notes,
  orderSummary,
  type,
}: OwnerAlertInput) {
  const label =
    type === "order"
      ? "New order"
      : type === "request"
        ? "New request"
        : "New inquiry";
  const summaryLabel = type === "inquiry" ? "Inquiry" : "Order";
  const summary = compact(orderSummary || "None");
  const noteText = compact(notes || "None");

  return truncate(
    `${label}: ${customerName}\n${summaryLabel}: ${summary}\nNotes: ${noteText}`,
    480,
  );
}

export function buildOwnerAlertSubject(type: OwnerAlertInput["type"], customerName: string) {
  const label =
    type === "order"
      ? "New order"
      : type === "request"
        ? "New request"
        : "New inquiry";
  return `${label}: ${customerName}`;
}

export async function sendOwnerAlert(input: OwnerAlertInput) {
  if (!envFlagEnabled("OWNER_ALERTS_ENABLED")) return;

  const recipients = getOwnerAlertRecipients();
  if (!recipients.length) return;

  const subject = buildOwnerAlertSubject(input.type, input.customerName);
  const body = buildOwnerAlertMessage(input);
  const results = await Promise.allSettled(
    recipients.map((to) =>
      sendOwnerShortAlert({
        to,
        subject,
        body,
        orderId: input.orderId,
        customerMessageId: input.customerMessageId,
      }),
    ),
  );

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error("[owner-alert] send failed", {
        to: recipients[index],
        error:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
      });
    }
  });
}
