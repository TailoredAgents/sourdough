import { Resend } from "resend";

type ConfirmationEmail = {
  to: string;
  customerName: string;
  orderSummary: string;
  deliveryWindow: string;
};

export async function sendOrderConfirmation({
  to,
  customerName,
  orderSummary,
  deliveryWindow,
}: ConfirmationEmail) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || "L&L Sourdough <orders@landlsourdough.com>";

  if (!apiKey) {
    console.log("[email:demo]", {
      to,
      subject: "We received your L&L Sourdough order",
      customerName,
      orderSummary,
      deliveryWindow,
    });
    return { demo: true };
  }

  const resend = new Resend(apiKey);
  return resend.emails.send({
    from,
    to,
    subject: "We received your L&L Sourdough order",
    text: `Hi ${customerName},\n\nThank you for ordering from L&L Sourdough.\n\nOrder:\n${orderSummary}\n\nDelivery window: ${deliveryWindow}\n\nWe will reach out if anything needs confirmation.\n\nL&L Sourdough`,
  });
}
