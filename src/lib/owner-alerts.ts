import {
  getSentEmailEventState,
  hasSentEmailEvent,
  sendOwnerShortAlert,
} from "./email";

type OwnerAlertInput = {
  type: "order" | "request" | "inquiry";
  customerName: string;
  orderSummary?: string;
  notes?: string | null;
  orderId?: string;
  customerMessageId?: string;
  throwOnFailure?: boolean;
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

const SMS_GATEWAY_SAFE_TOTAL = 140;
const SMS_GATEWAY_SUBJECT_RESERVE = 12;

function splitSmsText(value: string, maxLength: number) {
  const words = value.split(" ");
  const parts: string[] = [];
  let current = "";

  for (const originalWord of words) {
    let word = originalWord;
    if (!word) continue;

    while (word.length > maxLength) {
      if (current) {
        parts.push(current);
        current = "";
      }
      parts.push(word.slice(0, maxLength));
      word = word.slice(maxLength);
    }

    if (!word) continue;
    if (!current) {
      current = word;
    } else if (current.length + word.length + 1 <= maxLength) {
      current += ` ${word}`;
    } else {
      parts.push(current);
      current = word;
    }
  }

  if (current) parts.push(current);
  return parts.length ? parts : ["None"];
}

function smsSummary(value?: string) {
  return (value || "None")
    .split(/\r?\n/)
    .map((line) => compact(line).replace(/^(\d+)\s+x\s+/i, "$1x "))
    .filter(Boolean)
    .join("; ");
}

export function buildOwnerSmsAlertParts(
  {
    customerName,
    notes,
    orderSummary,
    type,
  }: OwnerAlertInput,
  recipient: string,
) {
  const typeLabel =
    type === "order" ? "Order" : type === "request" ? "Request" : "Inquiry";
  const summary = smsSummary(orderSummary);
  const noteText = compact(notes || "None");
  const message = compact(
    `${typeLabel} | ${customerName} | Note: ${noteText} | ${summary}`,
  );
  const bodyLimit = Math.max(
    1,
    SMS_GATEWAY_SAFE_TOTAL -
      recipient.length -
      SMS_GATEWAY_SUBJECT_RESERVE,
  );
  const bodies = splitSmsText(message, bodyLimit);

  return bodies.map((body, index) => ({
    subject: `L&L ${index + 1}/${bodies.length}`,
    body,
    eventKey: `owner-short-alert-v2:${index + 1}/${bodies.length}`,
  }));
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

  const smsRecipients = new Set(
    splitEmailList(process.env.OWNER_ALERT_SMS_EMAIL),
  );

  const results = await Promise.allSettled(
    recipients.map(async (to) => {
      if (!smsRecipients.has(to)) {
        const alreadySent = await hasSentEmailEvent({
          template: "owner_short_alert",
          to,
          orderId: input.orderId,
          customerMessageId: input.customerMessageId,
        });
        if (alreadySent) return;

        await sendOwnerShortAlert({
          to,
          subject: buildOwnerAlertSubject(input.type, input.customerName),
          body: buildOwnerAlertMessage(input),
          orderId: input.orderId,
          customerMessageId: input.customerMessageId,
        });
        return;
      }

      const sentState = await getSentEmailEventState({
        template: "owner_short_alert",
        to,
        orderId: input.orderId,
        customerMessageId: input.customerMessageId,
      });
      if (sentState.hasLegacyEvent) return;

      const sentKeys = new Set(sentState.eventKeys);
      const parts = buildOwnerSmsAlertParts(input, to);
      for (const part of parts) {
        if (sentKeys.has(part.eventKey)) continue;
        await sendOwnerShortAlert({
          to,
          subject: part.subject,
          body: part.body,
          orderId: input.orderId,
          customerMessageId: input.customerMessageId,
          eventKey: part.eventKey,
        });
      }
    }),
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

  const failedCount = results.filter(
    (result) => result.status === "rejected",
  ).length;
  if (failedCount && input.throwOnFailure) {
    throw new Error(
      `${failedCount} owner alert${failedCount === 1 ? "" : "s"} failed to send.`,
    );
  }
}
