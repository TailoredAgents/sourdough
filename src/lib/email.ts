import { Resend } from "resend";
import { bakery } from "./bakery-data";
import { getSupabaseAdminClient } from "./supabase";
import { absoluteUrl } from "./url";

export type EmailTemplate =
  | "customer_order_confirmation"
  | "customer_approval_request_received"
  | "owner_new_order"
  | "owner_approval_request"
  | "owner_short_alert"
  | "last_minute_request"
  | "order_status_update"
  | "customer_order_thank_you"
  | "customer_message_reply"
  | "bread_club_magic_link"
  | "bread_club_welcome"
  | "bread_club_selection_reminder"
  | "bread_club_skip_credit"
  | "bread_club_addon_receipt"
  | "bread_club_renewal"
  | "bread_club_payment_failure"
  | "bread_club_plan_change"
  | "bread_club_cancellation"
  | "bread_club_owner_alert"
  | "bread_club_friday_summary";

type BaseEmail = {
  to: string;
  customerName: string;
  orderSummary: string;
  deliveryWindow: string;
  orderId?: string;
  customerMessageId?: string;
  idempotencyKey?: string;
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

type CompletionThankYouEmail = BaseEmail & {
  reviewUrl?: string;
};

type CustomerReplyEmail = {
  to: string;
  subject: string;
  body: string;
  customerMessageId: string;
  idempotencyKey?: string;
};

type OwnerShortAlertEmail = {
  to: string;
  subject: string;
  body: string;
  orderId?: string;
  customerMessageId?: string;
  eventKey?: string;
  idempotencyKey?: string;
};

function fromAddress() {
  return (
    process.env.RESEND_FROM ||
    "Luna & Lorelai's Sourdough <orders@landlsourdough.com>"
  );
}

function buildProviderResponse(
  providerResponse: unknown,
  eventKey?: string,
) {
  const response: Record<string, unknown> =
    providerResponse &&
    typeof providerResponse === "object" &&
    !Array.isArray(providerResponse)
      ? { ...(providerResponse as Record<string, unknown>) }
      : providerResponse
        ? { value: String(providerResponse) }
        : {};

  if (eventKey) response.event_key = eventKey;
  return Object.keys(response).length ? response : null;
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
  breadClubMembershipId,
  status,
  providerId,
  providerResponse,
  errorMessage,
  eventKey,
}: {
  template: EmailTemplate;
  to: string;
  orderId?: string;
  customerMessageId?: string;
  breadClubMembershipId?: string;
  status: "sent" | "demo" | "failed";
  providerId?: string;
  providerResponse?: unknown;
  errorMessage?: string;
  eventKey?: string;
}) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return;

  const { error } = await supabase.from("email_events").insert({
    template,
    recipient: to,
    order_id: orderId || null,
    customer_message_id: customerMessageId || null,
    bread_club_membership_id: breadClubMembershipId || null,
    status,
    provider_id: providerId || null,
    provider_response: buildProviderResponse(providerResponse, eventKey),
    error_message: errorMessage || null,
  });

  if (error) {
    console.error("[email] event log failed", error.message);
  }
}

export async function hasSentEmailEvent({
  template,
  to,
  orderId,
  customerMessageId,
  breadClubMembershipId,
  eventKey,
}: {
  template: EmailTemplate;
  to: string;
  orderId?: string;
  customerMessageId?: string;
  breadClubMembershipId?: string;
  eventKey?: string;
}) {
  const supabase = getSupabaseAdminClient();
  if (
    !supabase ||
    (!orderId && !customerMessageId && !breadClubMembershipId)
  ) {
    return false;
  }

  let query = supabase
    .from("email_events")
    .select("id")
    .eq("template", template)
    .eq("recipient", to)
    .eq("status", "sent")
    .limit(1);

  query = orderId
    ? query.eq("order_id", orderId)
    : customerMessageId
      ? query.eq("customer_message_id", customerMessageId)
      : query.eq("bread_club_membership_id", breadClubMembershipId as string);
  if (eventKey) {
    query = query.contains("provider_response", {
      event_key: eventKey,
    });
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function getSentEmailEventState({
  template,
  to,
  orderId,
  customerMessageId,
}: {
  template: EmailTemplate;
  to: string;
  orderId?: string;
  customerMessageId?: string;
}) {
  const emptyState = {
    hasLegacyEvent: false,
    eventKeys: [] as string[],
  };
  const supabase = getSupabaseAdminClient();
  if (!supabase || (!orderId && !customerMessageId)) return emptyState;

  let query = supabase
    .from("email_events")
    .select("provider_response")
    .eq("template", template)
    .eq("recipient", to)
    .eq("status", "sent");

  query = orderId
    ? query.eq("order_id", orderId)
    : query.eq("customer_message_id", customerMessageId as string);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const eventKeys: string[] = [];
  let hasLegacyEvent = false;
  for (const row of data || []) {
    const response =
      row.provider_response &&
      typeof row.provider_response === "object" &&
      !Array.isArray(row.provider_response)
        ? (row.provider_response as Record<string, unknown>)
        : null;
    if (typeof response?.event_key === "string") {
      eventKeys.push(response.event_key);
    } else {
      hasLegacyEvent = true;
    }
  }

  return { hasLegacyEvent, eventKeys };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function emailParagraph(value: string) {
  return `<p style="margin:0 0 16px;color:#44403c;font-size:15px;line-height:1.65">${escapeHtml(value).replaceAll("\n", "<br>")}</p>`;
}

function renderOrderDetails({
  orderId,
  orderSummary,
  deliveryWindow,
}: Pick<BaseEmail, "orderId" | "orderSummary" | "deliveryWindow">) {
  const orderReference = orderId
    ? `<strong>Order #${escapeHtml(orderId.slice(0, 8))}</strong><br><br>`
    : "";
  const summary = escapeHtml(orderSummary).replaceAll("\n", "<br>");

  return `<div style="margin:20px 0;padding:16px;background:#fffaf2;border:1px solid #e7e5e4;color:#44403c;font-size:14px;line-height:1.7">
    ${orderReference}<strong>Order</strong><br>${summary}<br><br>
    <strong>Scheduled delivery</strong><br>${escapeHtml(deliveryWindow)}
  </div>`;
}

export function renderBrandedCustomerEmail(input: {
  subject: string;
  preheader: string;
  eyebrow: string;
  heading: string;
  body: string;
  action?: { label: string; href: string };
  note?: string;
}) {
  const logoUrl = absoluteUrl("/images/luna-lorelais-logo-square-180.png");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(input.subject)}</title>
  </head>
  <body style="margin:0;background:#f7f5f2;font-family:Arial,Helvetica,sans-serif;color:#1c1917">
    <span style="display:none;max-height:0;overflow:hidden">${escapeHtml(input.preheader)}</span>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f5f2">
      <tr>
        <td align="center" style="padding:24px 12px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #e7e5e4">
            <tr>
              <td align="center" style="padding:24px;background:#23443b;color:#ffffff;text-align:center">
                <img src="${escapeHtml(logoUrl)}" width="72" height="72" alt="Luna &amp; Lorelai&apos;s Sourdough logo" style="display:block;width:72px;height:72px;margin:0 auto 16px;border:3px solid #fffaf2;border-radius:999px;background:#ffffff">
                <p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase">${escapeHtml(input.eyebrow)}</p>
                <h1 style="margin:0;font-size:26px;line-height:1.25">${escapeHtml(input.heading)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 24px">
                ${input.body}
                ${
                  input.action
                    ? `<p style="margin:24px 0 18px"><a href="${escapeHtml(input.action.href)}" style="display:inline-block;background:#a94334;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:6px">${escapeHtml(input.action.label)}</a></p>`
                    : ""
                }
                ${
                  input.note
                    ? `<p style="margin:0;color:#57534e;font-size:13px;line-height:1.6">${escapeHtml(input.note)}</p>`
                    : ""
                }
              </td>
            </tr>
            <tr>
              <td style="padding:18px 24px;background:#fffaf2;color:#57534e;font-size:12px;line-height:1.6">
                Luna &amp; Lorelai&apos;s Sourdough<br>
                Canton and Woodstock, Georgia
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderCustomerConfirmation({
  customerName,
  orderSummary,
  deliveryWindow,
  orderId,
}: BaseEmail) {
  const subject = `Your ${bakery.name} order is confirmed`;
  const orderReference = orderId ? `Order #${orderId.slice(0, 8)}\n\n` : "";

  return {
    subject,
    text: `Hi ${customerName},\n\nThank you for ordering from ${bakery.name}. We've received your order, and your selected Sunday delivery is set.\n\n${orderReference}Order:\n${orderSummary}\n\nScheduled delivery:\n${deliveryWindow}\n\nWhat happens next:\n- We'll prepare everything fresh for your selected delivery.\n- Watch your email for order and delivery updates.\n- Reply to this email as soon as possible if your delivery details need a correction.\n\n${bakery.name}`,
    html: renderBrandedCustomerEmail({
      subject,
      preheader: "Your Sunday delivery is set—we're excited to bake for you.",
      eyebrow: "Order confirmation",
      heading: "Your order is confirmed!",
      body:
        emailParagraph(`Hi ${customerName},`) +
        emailParagraph(
          `Thank you for ordering from ${bakery.name}. We've received your order, and your selected Sunday delivery is set.`,
        ) +
        renderOrderDetails({ orderId, orderSummary, deliveryWindow }) +
        `<h2 style="margin:24px 0 10px;font-size:17px;color:#1c1917">What happens next</h2>
        <ul style="margin:0;padding-left:20px;color:#44403c;font-size:15px;line-height:1.8">
          <li>We&apos;ll prepare everything fresh for your selected delivery.</li>
          <li>Watch your email for order and delivery updates.</li>
          <li>Reply to this email as soon as possible if your delivery details need a correction.</li>
        </ul>`,
    }),
  };
}

function renderCustomerApprovalRequestReceived({
  customerName,
  orderSummary,
  deliveryWindow,
  orderId,
}: BaseEmail) {
  const subject = `We received your ${bakery.name} approval request`;

  return {
    subject,
    text: `Hi ${customerName},\n\nPayment was received for your same-week approval request. Grace will review it and either accept it, move it to next Sunday if you allowed that, or refund it if it cannot be filled.\n\nRequested order:\n${orderSummary}\n\nRequested Sunday delivery time: ${deliveryWindow}\n\nPlease reply to this email if your delivery details need a correction.\n\n${bakery.name}`,
    html: renderBrandedCustomerEmail({
      subject,
      preheader: "Your same-week request is waiting for bakery approval.",
      eyebrow: "Approval request",
      heading: "We received your request",
      body:
        emailParagraph(`Hi ${customerName},`) +
        emailParagraph(
          "Payment was received for your same-week approval request. Grace will review it and either accept it, move it to next Sunday if you allowed that, or refund it if it cannot be filled.",
        ) +
        renderOrderDetails({ orderId, orderSummary, deliveryWindow }),
      note: "Reply to this email if your delivery details need a correction.",
    }),
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
    text: `New paid order received.\n\nCustomer: ${customerName}\nEmail: ${customerEmail}\nPhone: ${customerPhone}\n\nOrder:\n${orderSummary}\n\nSunday delivery time: ${deliveryWindow}\nAddress: ${address}\nNotes: ${notes || "None"}`,
  };
}

function renderOwnerApprovalRequest({
  customerName,
  customerEmail,
  customerPhone,
  orderSummary,
  deliveryWindow,
  address,
  notes,
}: OwnerEmail) {
  return {
    subject: `Approval needed for ${customerName}'s sourdough order`,
    text: `Paid same-week approval request received.\n\nCustomer: ${customerName}\nEmail: ${customerEmail}\nPhone: ${customerPhone}\n\nRequested order:\n${orderSummary}\n\nRequested Sunday delivery time: ${deliveryWindow}\nAddress: ${address}\nNotes: ${notes || "None"}\n\nOpen the admin order dashboard to accept, move to next Sunday, or deny and refund.`,
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
    text: `A last-minute request was submitted after the cutoff.\n\nCustomer: ${customerName}\nEmail: ${customerEmail}\nPhone: ${customerPhone}\n\nRequested items:\n${orderSummary}\n\nPreferred Sunday delivery time: ${deliveryWindow}\nAddress: ${address}\nNotes: ${notes || "None"}`,
  };
}

function renderStatusUpdate({
  customerName,
  orderSummary,
  deliveryWindow,
  orderId,
  statusLabel,
}: StatusEmail) {
  const subject = `Your sourdough order is ${statusLabel.toLowerCase()}`;

  return {
    subject,
    text: `Hi ${customerName},\n\nYour ${bakery.name} order status is now: ${statusLabel}.\n\nOrder:\n${orderSummary}\n\nSunday delivery time: ${deliveryWindow}\n\nReply to this email if anything needs attention.\n\n${bakery.name}`,
    html: renderBrandedCustomerEmail({
      subject,
      preheader: `Your order status is now ${statusLabel}.`,
      eyebrow: "Order update",
      heading: statusLabel,
      body:
        emailParagraph(`Hi ${customerName},`) +
        emailParagraph(`Your ${bakery.name} order status is now ${statusLabel}.`) +
        renderOrderDetails({ orderId, orderSummary, deliveryWindow }),
      note: "Reply to this email if anything needs attention.",
    }),
  };
}

export function getBakeryReviewUrl(
  configuredUrl = process.env.BAKERY_REVIEW_URL,
) {
  const value = configuredUrl?.trim();
  if (value) {
    try {
      const url = new URL(value);
      if (url.protocol === "https:" || url.protocol === "http:") {
        return url.toString();
      }
    } catch {
      // Fall through to a working private-feedback link.
    }
  }

  const params = new URLSearchParams({
    subject: `Review for ${bakery.name}`,
    body: `I'd like to share a review of my order:\n\n`,
  });
  return `mailto:${bakery.orderEmail}?${params.toString()}`;
}

function renderOrderCompletionThankYou({
  customerName,
  orderSummary,
  deliveryWindow,
  reviewUrl,
  orderId,
}: CompletionThankYouEmail & { reviewUrl: string }) {
  const subject = "Thank you for your sourdough order";
  const orderReference = orderId ? `Order #${orderId.slice(0, 8)}\n\n` : "";

  return {
    subject,
    text: `Hi ${customerName},\n\nThank you for choosing ${bakery.name}. We hope you enjoy your order!\n\n${orderReference}Order:\n${orderSummary}\n\nSunday delivery:\n${deliveryWindow}\n\nWe'd love to hear how it went. Your honest feedback helps our small local bakery grow.\n\nLeave a review:\n${reviewUrl}\n\nIf anything wasn't right, reply to this email so we can help.\n\n${bakery.name}`,
    html: renderBrandedCustomerEmail({
      subject,
      preheader: "Thank you for supporting our small local bakery.",
      eyebrow: bakery.name,
      heading: "Thank you for your order!",
      body:
        emailParagraph(`Hi ${customerName},`) +
        emailParagraph(
          `Thank you for choosing ${bakery.name}. We hope you enjoy your order!`,
        ) +
        renderOrderDetails({
          orderId,
          orderSummary,
          deliveryWindow,
        }) +
        emailParagraph(
          "We'd love to hear how it went. Your honest feedback helps our small local bakery grow.",
        ),
      action: { label: "Leave a review", href: reviewUrl },
      note: "If anything wasn't right, reply to this email so we can help.",
    }),
  };
}

function renderCustomerMessageReply({ subject, body }: CustomerReplyEmail) {
  return {
    subject,
    text: `${body}\n\n${bakery.name}`,
    html: renderBrandedCustomerEmail({
      subject,
      preheader: "A message from Luna & Lorelai's Sourdough.",
      eyebrow: "A note from the bakery",
      heading: subject,
      body: emailParagraph(body),
    }),
  };
}

function getResendErrorMessage(result: unknown) {
  if (
    result &&
    typeof result === "object" &&
    "error" in result &&
    result.error &&
    typeof result.error === "object" &&
    "message" in result.error
  ) {
    return String(result.error.message);
  }

  return null;
}

async function sendTemplatedEmail({
  template,
  to,
  orderId,
  customerMessageId,
  breadClubMembershipId,
  subject,
  text,
  html,
  eventKey,
  idempotencyKey,
}: {
  template: EmailTemplate;
  to: string;
  orderId?: string;
  customerMessageId?: string;
  breadClubMembershipId?: string;
  subject: string;
  text: string;
  html?: string;
  eventKey?: string;
  idempotencyKey?: string;
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
        breadClubMembershipId,
        status: "failed",
        errorMessage: missingEmailError,
        eventKey,
      });
      throw new Error(missingEmailError);
    }

    console.log("[email:demo]", { to, subject, text });
    await logEmailEvent({
      template,
      to,
      orderId,
      customerMessageId,
      breadClubMembershipId,
      status: "demo",
      providerResponse: { demo: true },
      eventKey,
    });
    return { demo: true };
  }

  try {
    const resend = new Resend(apiKey);
    const message = {
      from: fromAddress(),
      to,
      subject,
      text,
      ...(html ? { html } : {}),
    };
    const result = idempotencyKey
      ? await resend.emails.send(message, { idempotencyKey })
      : await resend.emails.send(message);
    const resendErrorMessage = getResendErrorMessage(result);
    if (resendErrorMessage) {
      throw new Error(resendErrorMessage);
    }

    const providerId =
      "data" in result && result.data && "id" in result.data
        ? String(result.data.id)
        : undefined;

    await logEmailEvent({
      template,
      to,
      orderId,
      customerMessageId,
      breadClubMembershipId,
      status: "sent",
      providerId,
      providerResponse: result,
      eventKey,
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email send failed.";
    await logEmailEvent({
      template,
      to,
      orderId,
      customerMessageId,
      breadClubMembershipId,
      status: "failed",
      errorMessage: message,
      eventKey,
    });
    throw error;
  }
}

export async function sendCustomerOrderConfirmation(input: BaseEmail) {
  return sendTemplatedEmail({
    template: "customer_order_confirmation",
    to: input.to,
    orderId: input.orderId,
    idempotencyKey:
      input.idempotencyKey ||
      (input.orderId
        ? `storefront-order-confirmation:${input.orderId}`
        : undefined),
    ...renderCustomerConfirmation(input),
  });
}

export async function sendCustomerApprovalRequestReceived(input: BaseEmail) {
  return sendTemplatedEmail({
    template: "customer_approval_request_received",
    to: input.to,
    orderId: input.orderId,
    idempotencyKey:
      input.idempotencyKey ||
      (input.orderId
        ? `storefront-approval-received:${input.orderId}`
        : undefined),
    ...renderCustomerApprovalRequestReceived(input),
  });
}

export async function sendOwnerNewOrderNotification(input: OwnerEmail) {
  return sendTemplatedEmail({
    template: "owner_new_order",
    to: input.to,
    orderId: input.orderId,
    idempotencyKey:
      input.idempotencyKey ||
      (input.orderId
        ? `storefront-owner-new-order:${input.orderId}`
        : undefined),
    ...renderOwnerNewOrder(input),
  });
}

export async function sendOwnerApprovalRequestNotification(input: OwnerEmail) {
  return sendTemplatedEmail({
    template: "owner_approval_request",
    to: input.to,
    orderId: input.orderId,
    idempotencyKey:
      input.idempotencyKey ||
      (input.orderId
        ? `storefront-owner-approval:${input.orderId}`
        : undefined),
    ...renderOwnerApprovalRequest(input),
  });
}

export async function sendOwnerShortAlert(input: OwnerShortAlertEmail) {
  return sendTemplatedEmail({
    template: "owner_short_alert",
    to: input.to,
    orderId: input.orderId,
    customerMessageId: input.customerMessageId,
    subject: input.subject,
    text: input.body,
    eventKey: input.eventKey,
    idempotencyKey: input.idempotencyKey,
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

export async function sendOrderCompletionThankYou(input: CompletionThankYouEmail) {
  if (
    input.orderId &&
    (await hasSentEmailEvent({
      template: "customer_order_thank_you",
      to: input.to,
      orderId: input.orderId,
    }))
  ) {
    return { skipped: true };
  }

  const reviewUrl = getBakeryReviewUrl(input.reviewUrl);
  return sendTemplatedEmail({
    template: "customer_order_thank_you",
    to: input.to,
    orderId: input.orderId,
    idempotencyKey:
      input.idempotencyKey ||
      (input.orderId ? `completion-thank-you:${input.orderId}` : undefined),
    ...renderOrderCompletionThankYou({ ...input, reviewUrl }),
  });
}

export async function sendCustomerMessageReply(input: CustomerReplyEmail) {
  return sendTemplatedEmail({
    template: "customer_message_reply",
    to: input.to,
    customerMessageId: input.customerMessageId,
    idempotencyKey: input.idempotencyKey,
    ...renderCustomerMessageReply(input),
  });
}

export async function sendOrderConfirmation(input: BaseEmail) {
  return sendCustomerOrderConfirmation(input);
}

export async function sendBakeryTransactionalEmail(input: {
  template: EmailTemplate;
  to: string;
  subject: string;
  text: string;
  html: string;
  orderId?: string;
  breadClubMembershipId?: string;
  eventKey?: string;
  idempotencyKey?: string;
}) {
  if (
    input.eventKey &&
    input.breadClubMembershipId &&
    (await hasSentEmailEvent({
      template: input.template,
      to: input.to,
      breadClubMembershipId: input.breadClubMembershipId,
      eventKey: input.eventKey,
    }))
  ) {
    return { skipped: true };
  }
  return sendTemplatedEmail({
    ...input,
    idempotencyKey:
      input.idempotencyKey ||
      (input.eventKey
        ? `bread-club:${input.template}:${input.eventKey}`
        : undefined),
  });
}
