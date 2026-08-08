import {
  renderBrandedCustomerEmail,
  sendBakeryTransactionalEmail,
} from "@/lib/email";
import { formatCurrency } from "@/lib/utils";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function paragraph(value: string) {
  return `<p style="margin:0 0 16px;color:#44403c;font-size:15px;line-height:1.65">${escapeHtml(value)}</p>`;
}

function brandedHtml(input: {
  preheader: string;
  heading: string;
  body: string;
  action?: { label: string; href: string };
}) {
  return renderBrandedCustomerEmail({
    subject: input.heading,
    preheader: input.preheader,
    eyebrow: "Sunday Bread Club",
    heading: input.heading,
    body: input.body,
    action: input.action,
  });
}

export function sendBreadClubMagicLink(input: {
  to: string;
  customerName: string;
  link: string;
  membershipId: string;
}) {
  const subject = "Your secure Sunday Bread Club link";
  const text = `Hi ${input.customerName},\n\nUse this secure link to manage your Sunday Bread Club membership:\n${input.link}\n\nThe link expires in 20 minutes and can be used once. If you did not request it, you can ignore this email.\n\nLuna & Lorelai's Sourdough`;
  const html = brandedHtml({
    preheader: "Open your secure Bread Club account.",
    heading: "Your secure account link",
    body:
      paragraph(`Hi ${input.customerName},`) +
      paragraph(
        "Use the button below to review your next Sunday selection, skips, credits, add-ons, and billing.",
      ) +
      paragraph(
        "This link expires in 20 minutes and can be used once. If you did not request it, you can ignore this email.",
      ),
    action: { label: "Manage Bread Club", href: input.link },
  });
  return sendBakeryTransactionalEmail({
    template: "bread_club_magic_link",
    to: input.to,
    subject,
    text,
    html,
    breadClubMembershipId: input.membershipId,
  });
}

export function sendBreadClubWelcome(input: {
  to: string;
  customerName: string;
  membershipId: string;
  planName: string;
  recurringTotalCents: number;
  sundayLabels: string[];
  manageUrl: string;
}) {
  const dates = input.sundayLabels.join("\n");
  const subject = `Welcome to ${input.planName}`;
  const text = `Hi ${input.customerName},\n\nYour Sunday Bread Club membership is active. You will be charged ${formatCurrency(input.recurringTotalCents)} every four weeks, plus any confirmed applicable tax.\n\nYour first four deliveries:\n${dates}\n\nManage your selections, one included skip, add-ons, billing, or cancellation:\n${input.manageUrl}\n\nLuna & Lorelai's Sourdough`;
  const list = `<ul style="margin:0 0 18px;padding-left:20px;color:#44403c;line-height:1.8">${input.sundayLabels
    .map((label) => `<li>${escapeHtml(label)}</li>`)
    .join("")}</ul>`;
  const html = brandedHtml({
    preheader: "Your first four Sunday deliveries are reserved.",
    heading: `Welcome to ${input.planName}`,
    body:
      paragraph(`Hi ${input.customerName},`) +
      paragraph(
        `Your membership is active. The recurring total is ${formatCurrency(input.recurringTotalCents)} every four weeks, plus any confirmed applicable tax.`,
      ) +
      `<h2 style="font-size:17px;margin:22px 0 10px">Your first four Sundays</h2>${list}` +
      paragraph(
        "You can change available loaves or use your one included skip before Thursday at 11:59 PM.",
      ),
    action: { label: "Manage membership", href: input.manageUrl },
  });
  return sendBakeryTransactionalEmail({
    template: "bread_club_welcome",
    to: input.to,
    subject,
    text,
    html,
    breadClubMembershipId: input.membershipId,
  });
}

export function sendBreadClubSelectionReminder(input: {
  to: string;
  customerName: string;
  membershipId: string;
  deliveryLabel: string;
  selection: string;
  cutoffLabel: string;
  manageUrl: string;
}) {
  const subject = `Your ${input.deliveryLabel} Bread Club selection`;
  const text = `Hi ${input.customerName},\n\nCurrent selection: ${input.selection}\nDelivery: ${input.deliveryLabel}\nChange or skip by: ${input.cutoffLabel}\n\n${input.manageUrl}`;
  const html = brandedHtml({
    preheader: "Review your next Sunday loaf before Thursday night.",
    heading: "Review your next Sunday selection",
    body:
      paragraph(`Hi ${input.customerName},`) +
      paragraph(`Current selection: ${input.selection}`) +
      paragraph(`Delivery: ${input.deliveryLabel}`) +
      paragraph(`Change or skip by ${input.cutoffLabel}.`),
    action: { label: "Review selection", href: input.manageUrl },
  });
  return sendBakeryTransactionalEmail({
    template: "bread_club_selection_reminder",
    to: input.to,
    subject,
    text,
    html,
    breadClubMembershipId: input.membershipId,
  });
}

export function sendBreadClubSkipCredit(input: {
  to: string;
  customerName: string;
  membershipId: string;
  skippedDelivery: string;
  loafQuantity: number;
  deliveryCreditCents: number;
  expiresLabel: string;
  manageUrl: string;
}) {
  const subject = "Your Bread Club skip and rollover credit";
  const text = `Hi ${input.customerName},\n\n${input.skippedDelivery} was skipped. ${input.loafQuantity} loaf credit is available through ${input.expiresLabel}. A ${formatCurrency(input.deliveryCreditCents)} delivery credit will be applied to your next invoice.\n\n${input.manageUrl}`;
  const html = brandedHtml({
    preheader: "Your skip released Sunday capacity and created a rollover credit.",
    heading: "Your skip is confirmed",
    body:
      paragraph(`Hi ${input.customerName},`) +
      paragraph(`${input.skippedDelivery} was removed from the bake schedule.`) +
      paragraph(
        `${input.loafQuantity} loaf credit is available through ${input.expiresLabel}. A ${formatCurrency(input.deliveryCreditCents)} delivery credit will be applied to your next invoice.`,
      ),
    action: { label: "View rollover credit", href: input.manageUrl },
  });
  return sendBakeryTransactionalEmail({
    template: "bread_club_skip_credit",
    to: input.to,
    subject,
    text,
    html,
    breadClubMembershipId: input.membershipId,
  });
}

export function sendBreadClubAddonReceipt(input: {
  to: string;
  customerName: string;
  membershipId: string;
  deliveryLabel: string;
  orderSummary: string;
  totalCents: number;
}) {
  const subject = "Bread Club add-ons confirmed";
  const text = `Hi ${input.customerName},\n\nYour add-ons are attached to ${input.deliveryLabel} with no second delivery fee.\n\n${input.orderSummary}\nTotal: ${formatCurrency(input.totalCents)}`;
  const html = brandedHtml({
    preheader: "Your add-ons are attached to your existing Sunday delivery.",
    heading: "Add-ons confirmed",
    body:
      paragraph(`Hi ${input.customerName},`) +
      paragraph(input.orderSummary) +
      paragraph(
        `Total: ${formatCurrency(input.totalCents)}. These items will arrive with ${input.deliveryLabel}; no second delivery fee was charged.`,
      ),
  });
  return sendBakeryTransactionalEmail({
    template: "bread_club_addon_receipt",
    to: input.to,
    subject,
    text,
    html,
    breadClubMembershipId: input.membershipId,
  });
}

export function sendBreadClubRenewal(input: {
  to: string;
  customerName: string;
  membershipId: string;
  planName: string;
  amountCents: number;
  sundayLabels: string[];
  manageUrl: string;
}) {
  const subject = "Your Sunday Bread Club renewed";
  const text = `Hi ${input.customerName},\n\n${input.planName} renewed for ${formatCurrency(input.amountCents)}. Your next four Sundays are reserved:\n${input.sundayLabels.join("\n")}\n\n${input.manageUrl}`;
  const html = brandedHtml({
    preheader: "Your next four Sunday deliveries are reserved.",
    heading: "Your Bread Club renewed",
    body:
      paragraph(`Hi ${input.customerName},`) +
      paragraph(
        `${input.planName} renewed for ${formatCurrency(input.amountCents)}.`,
      ) +
      `<ul style="margin:0 0 18px;padding-left:20px;color:#44403c;line-height:1.8">${input.sundayLabels
        .map((label) => `<li>${escapeHtml(label)}</li>`)
        .join("")}</ul>`,
    action: { label: "Manage next deliveries", href: input.manageUrl },
  });
  return sendBakeryTransactionalEmail({
    template: "bread_club_renewal",
    to: input.to,
    subject,
    text,
    html,
    breadClubMembershipId: input.membershipId,
  });
}

export function sendBreadClubPaymentFailure(input: {
  to: string;
  customerName: string;
  membershipId: string;
  portalUrl: string;
}) {
  const subject = "Action needed for your Sunday Bread Club payment";
  const text = `Hi ${input.customerName},\n\nStripe could not complete your Bread Club renewal. Update your payment method here:\n${input.portalUrl}\n\nGrace will not bake an unpaid renewal cycle.`;
  const html = brandedHtml({
    preheader: "Update your payment method to keep the next cycle reserved.",
    heading: "Your renewal payment needs attention",
    body:
      paragraph(`Hi ${input.customerName},`) +
      paragraph(
        "Stripe could not complete your renewal payment. Please update your payment method so your upcoming Sunday deliveries can stay reserved.",
      ) +
      paragraph("Grace will not bake an unpaid renewal cycle."),
    action: { label: "Update payment method", href: input.portalUrl },
  });
  return sendBakeryTransactionalEmail({
    template: "bread_club_payment_failure",
    to: input.to,
    subject,
    text,
    html,
    breadClubMembershipId: input.membershipId,
  });
}

export function sendBreadClubPlanChange(input: {
  to: string;
  customerName: string;
  membershipId: string;
  newPlanName: string;
  effectiveLabel: string;
}) {
  const subject = "Your Bread Club plan change is scheduled";
  const text = `Hi ${input.customerName},\n\nYour membership will change to ${input.newPlanName} ${input.effectiveLabel}. Already-paid deliveries do not change.`;
  const html = brandedHtml({
    preheader: "Your plan change will begin with the next billing cycle.",
    heading: "Plan change scheduled",
    body:
      paragraph(`Hi ${input.customerName},`) +
      paragraph(
        `Your membership will change to ${input.newPlanName} ${input.effectiveLabel}. Already-paid deliveries do not change.`,
      ),
  });
  return sendBakeryTransactionalEmail({
    template: "bread_club_plan_change",
    to: input.to,
    subject,
    text,
    html,
    breadClubMembershipId: input.membershipId,
  });
}

export function sendBreadClubCancellation(input: {
  to: string;
  customerName: string;
  membershipId: string;
  finalDeliveryLabel: string;
}) {
  const subject = "Your Sunday Bread Club cancellation is confirmed";
  const text = `Hi ${input.customerName},\n\nYour membership will not renew again. Already-paid deliveries remain scheduled through ${input.finalDeliveryLabel}. Reply to this email if you need cancellation help.`;
  const html = brandedHtml({
    preheader: "Your membership will not renew again.",
    heading: "Cancellation confirmed",
    body:
      paragraph(`Hi ${input.customerName},`) +
      paragraph(
        `Your membership will not renew again. Already-paid deliveries remain scheduled through ${input.finalDeliveryLabel}.`,
      ) +
      paragraph(
        "Reply to this email if you need help with cancellation or an unused rollover credit.",
      ),
  });
  return sendBakeryTransactionalEmail({
    template: "bread_club_cancellation",
    to: input.to,
    subject,
    text,
    html,
    breadClubMembershipId: input.membershipId,
  });
}

export function sendBreadClubOwnerAlert(input: {
  to: string;
  membershipId: string;
  customerName: string;
  planName: string;
  amountCents: number;
  firstDeliveryLabel: string;
}) {
  const subject = `New Bread Club member: ${input.customerName}`;
  const text = `New paid Bread Club membership.\n\nCustomer: ${input.customerName}\nPlan: ${input.planName}\nCycle total: ${formatCurrency(input.amountCents)}\nFirst delivery: ${input.firstDeliveryLabel}\n\nOpen /admin/bread-club for all four reservations.`;
  const html = brandedHtml({
    preheader: "A new four-Sunday membership is paid and reserved.",
    heading: "New Bread Club membership",
    body:
      paragraph(`Customer: ${input.customerName}`) +
      paragraph(`Plan: ${input.planName}`) +
      paragraph(`Cycle total: ${formatCurrency(input.amountCents)}`) +
      paragraph(`First delivery: ${input.firstDeliveryLabel}`),
  });
  return sendBakeryTransactionalEmail({
    template: "bread_club_owner_alert",
    to: input.to,
    subject,
    text,
    html,
    breadClubMembershipId: input.membershipId,
  });
}

export function sendBreadClubFridaySummary(input: {
  to: string;
  deliveryLabel: string;
  productionLines: string[];
  memberCount: number;
}) {
  const subject = `Friday Bread Club bake sheet: ${input.deliveryLabel}`;
  const text = `${input.deliveryLabel}\n${input.memberCount} member deliveries\n\n${input.productionLines.join("\n")}`;
  const html = brandedHtml({
    preheader: "This Sunday's Bread Club production totals.",
    heading: "Friday Bread Club bake sheet",
    body:
      paragraph(input.deliveryLabel) +
      paragraph(`${input.memberCount} member deliveries`) +
      `<ul style="margin:0;padding-left:20px;color:#44403c;line-height:1.8">${input.productionLines
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join("")}</ul>`,
  });
  return sendBakeryTransactionalEmail({
    template: "bread_club_friday_summary",
    to: input.to,
    subject,
    text,
    html,
  });
}
