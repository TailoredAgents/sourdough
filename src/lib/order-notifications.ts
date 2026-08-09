import { sendOrderCompletionThankYou } from "./email";
import { getSupabaseAdminClient } from "./supabase";

type CompletionOrderRow = {
  id: string;
  customers:
    | { name: string; email: string }
    | Array<{ name: string; email: string }>
    | null;
  delivery_windows:
    | { label: string }
    | Array<{ label: string }>
    | null;
};

type CompletionItemRow = {
  quantity: number;
  products: { name: string } | Array<{ name: string }> | null;
};

function first<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function completionJobKey(orderId: string) {
  return `completion-thank-you:${orderId}`;
}

async function finishNotificationJob(
  jobKey: string,
  claimToken: string,
  status: "completed" | "failed",
  errorMessage?: string,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { data, error } = await supabase.rpc("finish_order_notification_job", {
    p_job_key: jobKey,
    p_claim_token: claimToken,
    p_status: status,
    p_error_message: errorMessage || null,
  });
  if (error) throw new Error(error.message);
  if (!data) {
    console.warn("[order-notification] stale worker completion ignored", {
      jobKey,
    });
  }
}

export async function processOrderCompletionNotification(orderId: string) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const jobKey = completionJobKey(orderId);
  const { data: claimed, error: claimError } = await supabase.rpc(
    "claim_order_notification_job",
    { p_job_key: jobKey },
  );
  if (claimError) throw new Error(claimError.message);
  if (!claimed) {
    const { data: existingJob, error: existingJobError } = await supabase
      .from("order_notification_jobs")
      .select("status")
      .eq("job_key", jobKey)
      .maybeSingle();
    if (existingJobError) throw new Error(existingJobError.message);
    return {
      state:
        existingJob?.status === "completed"
          ? ("already_sent" as const)
          : ("queued" as const),
    };
  }
  const claimToken = String(claimed);

  try {
    const [orderResult, itemsResult] = await Promise.all([
      supabase
        .from("orders")
        .select("id, customers(name, email), delivery_windows(label)")
        .eq("id", orderId)
        .eq("status", "delivered")
        .maybeSingle(),
      supabase
        .from("order_items")
        .select("quantity, products(name)")
        .eq("order_id", orderId),
    ]);
    if (orderResult.error) throw new Error(orderResult.error.message);
    if (itemsResult.error) throw new Error(itemsResult.error.message);
    if (!orderResult.data) {
      throw new Error("Delivered order could not be loaded for its thank-you email.");
    }

    const order = orderResult.data as CompletionOrderRow;
    const customer = first(order.customers);
    const deliveryWindow = first(order.delivery_windows);
    if (!customer?.email) {
      await finishNotificationJob(jobKey, claimToken, "completed");
      return { state: "skipped" as const };
    }
    const orderSummary = ((itemsResult.data || []) as CompletionItemRow[])
      .map((item) => {
        const product = first(item.products);
        return `${item.quantity} x ${product?.name || "Item"}`;
      })
      .join("\n");

    await sendOrderCompletionThankYou({
      to: customer.email,
      customerName: customer.name || "there",
      orderSummary: orderSummary || "Your sourdough order",
      deliveryWindow: deliveryWindow?.label || "Your Sunday delivery",
      orderId,
    });
    await finishNotificationJob(jobKey, claimToken, "completed");
    return { state: "sent" as const };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Thank-you email failed.";
    await finishNotificationJob(jobKey, claimToken, "failed", message);
    throw error;
  }
}

export async function processPendingOrderNotifications(limit = 25) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");
  const { data, error } = await supabase
    .from("order_notification_jobs")
    .select("job_key, order_id")
    .neq("status", "completed")
    .lte("available_at", new Date().toISOString())
    .order("available_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  const report = { checked: 0, sent: 0, queued: 0, errors: [] as string[] };
  for (const job of data || []) {
    report.checked += 1;
    try {
      const result = await processOrderCompletionNotification(String(job.order_id));
      if (result.state === "sent") report.sent += 1;
      else report.queued += 1;
    } catch (notificationError) {
      report.errors.push(
        `${job.job_key}: ${
          notificationError instanceof Error
            ? notificationError.message
            : "notification failed"
        }`,
      );
    }
  }
  return report;
}
