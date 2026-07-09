import { z } from "zod";
import type { CheckoutRequest, CustomerMessage, MenuProduct } from "./types";
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

type LastMinuteRequestInput = {
  checkout: CheckoutRequest;
  deliveryWindowLabel: string;
  items: Array<MenuProduct & { quantity: number }>;
};

export const customerMessageStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["new", "in_progress", "handled", "closed"]),
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
    `Preferred delivery window: ${deliveryWindowLabel}`,
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

  return mapCustomerMessage(data as CustomerMessageRow);
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
