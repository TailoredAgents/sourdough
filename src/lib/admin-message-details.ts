import type { CustomerMessage } from "./types";

export type AdminMessageDetails = {
  customerName: string | null;
  email: string | null;
  phone: string | null;
  requestedItems: string[];
  deliveryWindow: string | null;
  address: string | null;
  deliveryInstructions: string | null;
  notes: string | null;
  question: string | null;
  source: string | null;
  answerShown: string | null;
  zip: string | null;
  interest: string | null;
};

function labeledValue(lines: string[], label: string) {
  const prefix = `${label}:`;
  const line = lines.find((entry) => entry.startsWith(prefix));
  return line?.slice(prefix.length).trim() || null;
}

function firstLabeledValue(lines: string[], labels: string[]) {
  for (const label of labels) {
    const value = labeledValue(lines, label);
    if (value) return value;
  }
  return null;
}

function labeledBlock(lines: string[], label: string) {
  const startIndex = lines.findIndex((line) => line === `${label}:`);
  if (startIndex === -1) return [];

  const values: string[] = [];
  for (const line of lines.slice(startIndex + 1)) {
    if (!line.trim()) break;
    if (/^[A-Z][A-Za-z ]+:/.test(line)) break;
    values.push(line.trim());
  }
  return values;
}

export function parseAdminMessageDetails(body: string): AdminMessageDetails {
  const lines = body.split(/\r?\n/).map((line) => line.trim());

  return {
    customerName: labeledValue(lines, "Customer"),
    email: labeledValue(lines, "Email"),
    phone: labeledValue(lines, "Phone"),
    requestedItems: labeledBlock(lines, "Requested items"),
    deliveryWindow: firstLabeledValue(lines, [
      "Preferred Sunday delivery time",
      "Preferred delivery window",
    ]),
    address: labeledValue(lines, "Address"),
    deliveryInstructions: labeledValue(lines, "Delivery instructions"),
    notes: labeledValue(lines, "Notes"),
    question: labeledValue(lines, "Question"),
    source: labeledValue(lines, "Source"),
    answerShown: labeledValue(lines, "Answer shown"),
    zip: labeledValue(lines, "ZIP"),
    interest: labeledValue(lines, "Interest"),
  };
}

export function hasAdminMessageDetails(details: AdminMessageDetails | null) {
  if (!details) return false;
  return Boolean(
    details.customerName ||
      details.email ||
      details.phone ||
      details.requestedItems.length ||
      details.deliveryWindow ||
      details.address ||
      details.deliveryInstructions ||
      details.notes ||
      details.question ||
      details.source ||
      details.answerShown ||
      details.zip ||
      details.interest,
  );
}

export function getCustomerMessageReplyWarning(message: CustomerMessage | null) {
  if (!message) return null;
  if (!message.customerEmail) {
    return "This request does not include a customer email, so use the status buttons instead of Send reply.";
  }
  return null;
}

export function summarizeCustomerMessages(messages: CustomerMessage[]) {
  return messages.reduce(
    (summary, message) => ({
      new: summary.new + (message.status === "new" ? 1 : 0),
      inProgress: summary.inProgress + (message.status === "in_progress" ? 1 : 0),
      handled: summary.handled + (message.status === "handled" ? 1 : 0),
      noEmail: summary.noEmail + (message.customerEmail ? 0 : 1),
    }),
    {
      new: 0,
      inProgress: 0,
      handled: 0,
      noEmail: 0,
    },
  );
}
