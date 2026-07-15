import { Resend } from "resend";
import { getSupabaseAdminClient } from "./supabase";

type EmailTemplate =
  | "customer_order_confirmation"
  | "owner_new_order"
  | "last_minute_request"
  | "order_status_update"
  | "customer_message_reply";

type BaseEmail = {
  to: string;
  customerName: string;
  orderSummary: string;
  deliveryWindow: string;
  orderId?: string;
  customerMessageId?: string;
};

type OwnerEmail = BaseEmail & {
  customerEmail: string;
  customerPhone: string;
  address: string;
  notes?: string;
};

type StatusEmail = BaseEmail & {
  statusLabel: string;
};

type CustomerReplyEmail = {
  to: string;
  subject: string;
  body: string;
  customerMessageId: string;
};

function fromAddress() {
  return (
    process.env.RESEND_FROM ||
    "Luna & Lorelai's Sourdough <orders@landlsourdough.com>"
  );
}

export function getMissingResendEmailError(nodeEnv = process.env.NODE_ENV) {
  return nodeEnv === "production"
    ? "Email delivery is not configured. Set RESEND_API_KEY before sending production email."
    : null;
}

async function logEmailEvent({
  template,
  to,
  orderId,
  customerMessageId,
  status,
  providerId,
  providerResponse,
  errorMessage,
}: {
  template: EmailTemplate;
  to: string;
  orderId?: string;
  customerMessageId?: string;
  status: "sent" | "demo" | "failed";
  providerId?: string;
  providerResponse?: unknown;
  errorMessage?: string;
}) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return;

  const { error } = await supabase.from("email_events").insert({
    template,
    recipient: to,
    order_id: orderId || null,
    customer_message_id: customerMessageId || null,
    status,
    provider_id: providerId || null,
    provider_response:
      providerResponse && typeof providerResponse === "object"
        ? providerResponse
        : providerResponse
          ? { value: String(providerResponse) }
          : null,
    error_message: errorMessage || null,
  });

  if (error) {
    console.error("[email] event log failed", error.message);
  }
}

function renderCustomerConfirmation({
  customerName,
  orderSummary,
  deliveryWindow,
}: BaseEmail) {
  return {
    subject: "We received your Luna & Lorelai's Sourdough order",
    text: `Hi ${customerName},\n\nThank you for ordering from Luna & Lorelai's Sourdough.\n\nOrder:\n${orderSummary}\n\nDelivery window: ${deliveryWindow}\n\nPlease reply to this email if your delivery details need a correction. We will reach out if anything needs confirmation.\n\nLuna & Lorelai's Sourdough`,
  };
}

function renderOwnerNewOrder({
  customerName,
  customerEmail,
  customerPhone,
  orderSummary,
  deliveryWindow,
  address,
  notes,
}: OwnerEmail) {
  return {
    subject: `New sourdough order from ${customerName}`,
    text: `New paid order received.\n\nCustomer: ${customerName}\nEmail: ${customerEmail}\nPhone: ${customerPhone}\n\nOrder:\n${orderSummary}\n\nDelivery window: ${deliveryWindow}\nAddress: ${address}\nNotes: ${notes || "None"}`,
  };
}

function renderLastMinuteRequest({
  customerName,
  customerEmail,
  customerPhone,
  orderSummary,
  deliveryWindow,
  address,
  notes,
}: OwnerEmail) {
  return {
    subject: `Last-minute request from ${customerName}`,
    text: `A last-minute request was submitted after the cutoff.\n\nCustomer: ${customerName}\nEmail: ${customerEmail}\nPhone: ${customerPhone}\n\nRequested items:\n${orderSummary}\n\nPreferred delivery window: ${deliveryWindow}\nAddress: ${address}\nNotes: ${notes || "None"}`,
  };
}

function renderStatusUpdate({
  customerName,
  orderSummary,
  deliveryWindow,
  statusLabel,
}: StatusEmail) {
  return {
    subject: `Your sourdough order is ${statusLabel.toLowerCase()}`,
    text: `Hi ${customerName},\n\nYour Luna & Lorelai's Sourdough order status is now: ${statusLabel}.\n\nOrder:\n${orderSummary}\n\nDelivery window: ${deliveryWindow}\n\nReply to this email if anything needs attention.\n\nLuna & Lorelai's Sourdough`,
  };
}

function renderCustomerMessageReply({ subject, body }: CustomerReplyEmail) {
  return {
    subject,
    text: `${body}\n\nLuna & Lorelai's Sourdough`,
  };
}

async function sendTemplatedEmail({
  template,
  to,
  orderId,
  customerMessageId,
  subject,
  text,
}: {
  template: EmailTemplate;
  to: string;
  orderId?: string;
  customerMessageId?: string;
  subject: string;
  text: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    const missingEmailError = getMissingResendEmailError();
    if (missingEmailError) {
      await logEmailEvent({
        template,
        to,
        orderId,
        customerMessageId,
        status: "failed",
        errorMessage: missingEmailError,
      });
      throw new Error(missingEmailError);
    }

    console.log("[email:demo]", { to, subject, text });
    await logEmailEvent({
      template,
      to,
      orderId,
      customerMessageId,
      status: "demo",
      providerResponse: { demo: true },
    });
    return { demo: true };
  }

  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from: fromAddress(),
      to,
      subject,
      text,
    });
    const providerId =
      "data" in result && result.data && "id" in result.data
        ? String(result.data.id)
        : undefined;

    await logEmailEvent({
      template,
      to,
      orderId,
      customerMessageId,
      status: "sent",
      providerId,
      providerResponse: result,
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email send failed.";
    await logEmailEvent({
      template,
      to,
      orderId,
      customerMessageId,
      status: "failed",
      errorMessage: message,
    });
    throw error;
  }
}

export async function sendCustomerOrderConfirmation(input: BaseEmail) {
  return sendTemplatedEmail({
    template: "customer_order_confirmation",
    to: input.to,
    orderId: input.orderId,
    ...renderCustomerConfirmation(input),
  });
}

export async function sendOwnerNewOrderNotification(input: OwnerEmail) {
  return sendTemplatedEmail({
    template: "owner_new_order",
    to: input.to,
    orderId: input.orderId,
    ...renderOwnerNewOrder(input),
  });
}

export async function sendLastMinuteRequestNotification(input: OwnerEmail) {
  return sendTemplatedEmail({
    template: "last_minute_request",
    to: input.to,
    customerMessageId: input.customerMessageId,
    ...renderLastMinuteRequest(input),
  });
}

export async function sendOrderStatusUpdate(input: StatusEmail) {
  return sendTemplatedEmail({
    template: "order_status_update",
    to: input.to,
    orderId: input.orderId,
    ...renderStatusUpdate(input),
  });
}

export async function sendCustomerMessageReply(input: CustomerReplyEmail) {
  return sendTemplatedEmail({
    template: "customer_message_reply",
    to: input.to,
    customerMessageId: input.customerMessageId,
    ...renderCustomerMessageReply(input),
  });
}

export async function sendOrderConfirmation(input: BaseEmail) {
  return sendCustomerOrderConfirmation(input);
}
