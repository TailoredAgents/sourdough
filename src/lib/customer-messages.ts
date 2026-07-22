import { z } from "zod";
import type {
  CheckoutRequest,
  CustomerMessage,
  CustomerMessageReply,
  MenuProduct,
} from "./types";
import { sendCustomerMessageReply as sendCustomerMessageReplyEmail } from "./email";
import { sendOwnerAlert } from "./owner-alerts";
import { getSupabaseAdminClient } from "./supabase";

type CustomerMessageRow = {
  id: string;
  order_id: string | null;
  customer_email: string | null;
  subject: string;
  body: string;
  status: string;
  created_at: string;
};

type CustomerMessageReplyRow = {
  id: string;
  customer_message_id: string;
  admin_email: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  provider_id: string | null;
  error_message: string | null;
  created_at: string;
};

type LastMinuteRequestInput = {
  checkout: CheckoutRequest;
  deliveryWindowLabel: string;
  items: Array<MenuProduct & { quantity: number }>;
};

type BakeNotifySignupInput = {
  email: string;
  postalCode?: string;
  preference?: string;
  source?: string;
};

type CustomerQuestionInput = {
  question: string;
  answer?: string;
  source?: string;
};

export const customerMessageStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["new", "in_progress", "handled", "closed"]),
});

export const customerMessageReplySchema = z.object({
  id: z.string().uuid(),
  subject: z.string().min(2).max(160),
  body: z.string().min(2).max(4000),
  statusAfterSend: z.enum(["in_progress", "handled"]).default("handled"),
});

export const bakeNotifySignupSchema = z.object({
  email: z.string().trim().email(),
  postalCode: z
    .string()
    .trim()
    .optional()
    .default("")
    .refine((value) => value === "" || /^\d{5}$/.test(value), {
      message: "Enter a 5-digit ZIP code or leave it blank.",
    }),
  preference: z.string().trim().max(120).optional().default("Weekly menu alerts"),
  source: z.string().trim().max(80).optional().default("storefront"),
});

function mapCustomerMessage(row: CustomerMessageRow): CustomerMessage {
  return {
    id: row.id,
    orderId: row.order_id,
    customerEmail: row.customer_email,
    subject: row.subject,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapCustomerMessageReply(row: CustomerMessageReplyRow): CustomerMessageReply {
  return {
    id: row.id,
    customerMessageId: row.customer_message_id,
    adminEmail: row.admin_email,
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
    status: row.status,
    providerId: row.provider_id,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

function getProviderId(result: unknown) {
  if (
    result &&
    typeof result === "object" &&
    "data" in result &&
    result.data &&
    typeof result.data === "object" &&
    "id" in result.data
  ) {
    return String(result.data.id);
  }

  return null;
}

function buildItemSummary(items: LastMinuteRequestInput["items"]) {
  return items.map((item) => `${item.quantity} x ${item.name}`).join("\n");
}

export function buildLastMinuteRequestBody({
  checkout,
  deliveryWindowLabel,
  items,
}: LastMinuteRequestInput) {
  const address = checkout.address;
  return [
    `Customer: ${checkout.customer.name}`,
    `Email: ${checkout.customer.email}`,
    `Phone: ${checkout.customer.phone}`,
    "",
    "Requested items:",
    buildItemSummary(items),
    "",
    `Preferred Sunday delivery time: ${deliveryWindowLabel}`,
    `Address: ${address.line1}${address.line2 ? `, ${address.line2}` : ""}, ${address.city}, ${address.state} ${address.postalCode}`,
    `Delivery instructions: ${checkout.deliveryInstructions || "None"}`,
    "",
    `Notes: ${checkout.notes || "None"}`,
  ].join("\n");
}

export async function createLastMinuteCustomerMessage(
  input: LastMinuteRequestInput,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return null;

  const { checkout } = input;
  const { data, error } = await supabase
    .from("customer_messages")
    .insert({
      customer_email: checkout.customer.email.trim().toLowerCase(),
      subject: `Last-minute request from ${checkout.customer.name}`,
      body: buildLastMinuteRequestBody(input),
      status: "new",
    })
    .select("id, order_id, customer_email, subject, body, status, created_at")
    .single();

  if (error) {
    console.error("[supabase] customer message insert failed", error.message);
    return null;
  }

  const message = mapCustomerMessage(data as CustomerMessageRow);
  await sendOwnerAlert({
    type: "request",
    customerName: checkout.customer.name,
    orderSummary: buildItemSummary(input.items),
    notes: checkout.notes || checkout.deliveryInstructions || null,
    customerMessageId: message.id,
  });

  return message;
}

export function buildBakeNotifySignupBody({
  email,
  postalCode,
  preference,
  source,
}: BakeNotifySignupInput) {
  return [
    `Email: ${email.trim().toLowerCase()}`,
    `ZIP: ${postalCode?.trim() || "Not provided"}`,
    `Interest: ${preference?.trim() || "Weekly menu alerts"}`,
    `Source: ${source?.trim() || "storefront"}`,
  ].join("\n");
}

export async function createBakeNotifySignup(input: BakeNotifySignupInput) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return null;

  const email = input.email.trim().toLowerCase();
  const { data, error } = await supabase
    .from("customer_messages")
    .insert({
      customer_email: email,
      subject: `Bake notification signup from ${email}`,
      body: buildBakeNotifySignupBody(input),
      status: "new",
    })
    .select("id, order_id, customer_email, subject, body, status, created_at")
    .single();

  if (error) {
    console.error("[supabase] bake notification signup insert failed", error.message);
    return null;
  }

  const message = mapCustomerMessage(data as CustomerMessageRow);
  await sendOwnerAlert({
    type: "inquiry",
    customerName: email,
    orderSummary: "Bake notification signup",
    notes: buildBakeNotifySignupBody(input),
    customerMessageId: message.id,
  });

  return message;
}

export function buildCustomerQuestionBody({
  answer,
  question,
  source,
}: CustomerQuestionInput) {
  return [
    `Question: ${question.trim()}`,
    `Source: ${source?.trim() || "customer chat"}`,
    answer ? `Answer shown: ${answer.trim()}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function createCustomerQuestionMessage(input: CustomerQuestionInput) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("customer_messages")
    .insert({
      customer_email: null,
      subject: "Customer question from website chat",
      body: buildCustomerQuestionBody(input),
      status: "new",
    })
    .select("id, order_id, customer_email, subject, body, status, created_at")
    .single();

  if (error) {
    console.error("[supabase] customer question insert failed", error.message);
    return null;
  }

  const message = mapCustomerMessage(data as CustomerMessageRow);
  await sendOwnerAlert({
    type: "inquiry",
    customerName: "Website visitor",
    orderSummary: input.question,
    notes: input.answer || null,
    customerMessageId: message.id,
  });

  return message;
}

export async function getCustomerMessagesData(): Promise<CustomerMessage[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("customer_messages")
    .select("id, order_id, customer_email, subject, body, status, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("[supabase] customer messages lookup failed", error.message);
    return [];
  }

  return (data as CustomerMessageRow[]).map(mapCustomerMessage);
}

export async function updateCustomerMessageStatus(id: string, status: string) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { error } = await supabase
    .from("customer_messages")
    .update({ status })
    .eq("id", id);

  if (error) throw new Error(error.message);
  return getCustomerMessagesData();
}

export async function sendCustomerMessageReply({
  adminEmail,
  body,
  id,
  statusAfterSend,
  subject,
}: z.infer<typeof customerMessageReplySchema> & { adminEmail: string }) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data: message, error: lookupError } = await supabase
    .from("customer_messages")
    .select("id, customer_email")
    .eq("id", id)
    .maybeSingle();

  if (lookupError) throw new Error(lookupError.message);
  const recipient = String(message?.customer_email || "");
  if (!message || !recipient) {
    throw new Error("This message does not have a customer email to reply to.");
  }

  const { data: reply, error: insertError } = await supabase
    .from("customer_message_replies")
    .insert({
      customer_message_id: id,
      admin_email: adminEmail,
      recipient,
      subject,
      body,
      status: "pending",
    })
    .select(
      "id, customer_message_id, admin_email, recipient, subject, body, status, provider_id, error_message, created_at",
    )
    .single();

  if (insertError) throw new Error(insertError.message);
  const replyRow = reply as CustomerMessageReplyRow;

  try {
    const result = await sendCustomerMessageReplyEmail({
      to: recipient,
      subject,
      body,
      customerMessageId: id,
    });
    const providerId = getProviderId(result);
    const { error: updateReplyError } = await supabase
      .from("customer_message_replies")
      .update({
        status: "sent",
        provider_id: providerId,
      })
      .eq("id", replyRow.id);

    if (updateReplyError) throw new Error(updateReplyError.message);

    const { error: updateMessageError } = await supabase
      .from("customer_messages")
      .update({ status: statusAfterSend })
      .eq("id", id);

    if (updateMessageError) throw new Error(updateMessageError.message);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reply could not be sent.";
    await supabase
      .from("customer_message_replies")
      .update({
        status: "failed",
        error_message: message,
      })
      .eq("id", replyRow.id);
    throw error;
  }

  return {
    messages: await getCustomerMessagesData(),
    reply: mapCustomerMessageReply({
      ...replyRow,
      status: "sent",
      provider_id: null,
      error_message: null,
    }),
  };
}
