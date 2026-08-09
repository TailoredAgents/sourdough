import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getBakeryReviewUrl,
  getMissingResendEmailError,
  sendCustomerApprovalRequestReceived,
  sendCustomerMessageReply,
  sendCustomerOrderConfirmation,
  sendOrderCompletionThankYou,
  sendOrderStatusUpdate,
  sendOwnerShortAlert,
} from "./email";
import { sendBreadClubWelcome } from "./bread-club/emails";

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
}));

const emailLogoMarkup =
  'src="https://www.landlsourdough.com/images/luna-lorelais-logo-square-180.png"';

vi.mock("resend", () => ({
  Resend: vi.fn(function Resend() {
    return {
      emails: {
        send: sendMock,
      },
    };
  }),
}));

vi.mock("./supabase", () => ({
  getSupabaseAdminClient: () => null,
}));

beforeEach(() => {
  sendMock.mockReset();
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
  delete process.env.BAKERY_REVIEW_URL;
});

describe("email configuration safety", () => {
  it("allows demo email only outside production", () => {
    expect(getMissingResendEmailError("development")).toBeNull();
    expect(getMissingResendEmailError("test")).toBeNull();
    expect(getMissingResendEmailError("production")).toContain(
      "Email delivery is not configured",
    );
  });

  it("throws when Resend returns an API error response", async () => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.RESEND_FROM = "Luna & Lorelai's Sourdough <orders@landlsourdough.com>";
    sendMock.mockResolvedValue({
      data: null,
      error: { message: "The domain is not verified." },
    });

    await expect(
      sendOwnerShortAlert({
        to: "owner@example.com",
        subject: "New inquiry",
        body: "New inquiry: Test\nInquiry: Test\nNotes: None",
      }),
    ).rejects.toThrow("The domain is not verified.");
  });

  it("sends a branded confirmation with the order and scheduled delivery", async () => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.RESEND_FROM = "Luna & Lorelai's Sourdough <orders@landlsourdough.com>";
    sendMock.mockResolvedValue({ data: { id: "email_confirmation" }, error: null });

    await sendCustomerOrderConfirmation({
      to: "customer@example.com",
      customerName: "First <Customer>",
      orderSummary: "1 x Bread & Butter",
      deliveryWindow: "Sunday, Aug 9, 3:00 PM-6:00 PM",
      orderId: "12345678-1111-4111-8111-111111111111",
    });

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "customer@example.com",
        subject: "Your Luna & Lorelai's Sourdough order is confirmed",
        text: expect.stringContaining(
          "We've received your order, and your selected Sunday delivery is set.",
        ),
        html: expect.stringContaining("Your order is confirmed!"),
      }),
      {
        idempotencyKey:
          "storefront-order-confirmation:12345678-1111-4111-8111-111111111111",
      },
    );
    expect(sendMock.mock.calls[0]?.[0]?.html).toContain("Order #12345678");
    expect(sendMock.mock.calls[0]?.[0]?.html).toContain(
      "First &lt;Customer&gt;",
    );
    expect(sendMock.mock.calls[0]?.[0]?.html).toContain(
      "1 x Bread &amp; Butter",
    );
    expect(sendMock.mock.calls[0]?.[0]?.html).toContain(emailLogoMarkup);
    expect(sendMock.mock.calls[0]?.[0]?.html).toContain(
      "Luna &amp; Lorelai&apos;s Sourdough logo",
    );
    expect(sendMock.mock.calls[0]?.[0]?.text).not.toContain("payment");
  });

  it("adds the logo to approval, status, reply, and Bread Club emails", async () => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.RESEND_FROM = "Luna & Lorelai's Sourdough <orders@landlsourdough.com>";
    sendMock.mockResolvedValue({ data: { id: "email_branded" }, error: null });

    await sendCustomerApprovalRequestReceived({
      to: "customer@example.com",
      customerName: "First Customer",
      orderSummary: "1 x Classic Country Loaf",
      deliveryWindow: "Sunday, Aug 9, 3:00 PM-6:00 PM",
      orderId: "11111111-1111-4111-8111-111111111111",
    });
    await sendOrderStatusUpdate({
      to: "customer@example.com",
      customerName: "First Customer",
      orderSummary: "1 x Classic Country Loaf",
      deliveryWindow: "Sunday, Aug 9, 3:00 PM-6:00 PM",
      orderId: "11111111-1111-4111-8111-111111111111",
      statusLabel: "Baking soon",
    });
    await sendCustomerMessageReply({
      to: "customer@example.com",
      subject: "Answer about your order",
      body: "Your order is all set.\nWe'll see you Sunday!",
      customerMessageId: "22222222-2222-4222-8222-222222222222",
    });
    await sendBreadClubWelcome({
      to: "member@example.com",
      customerName: "Bread Club Member",
      membershipId: "33333333-3333-4333-8333-333333333333",
      planName: "Sunday Bread Club",
      recurringTotalCents: 8000,
      sundayLabels: ["Aug 9", "Aug 16", "Aug 23", "Aug 30"],
      manageUrl: "https://www.landlsourdough.com/bread-club/manage",
    });

    expect(sendMock).toHaveBeenCalledTimes(4);
    for (const [message] of sendMock.mock.calls) {
      expect(message.html).toContain(emailLogoMarkup);
    }
  });

  it("sends a branded completion thank-you with the configured review link", async () => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.RESEND_FROM = "Luna & Lorelai's Sourdough <orders@landlsourdough.com>";
    process.env.BAKERY_REVIEW_URL = "https://example.com/review/luna-and-lorelai";
    sendMock.mockResolvedValue({ data: { id: "email_thank_you" }, error: null });

    await sendOrderCompletionThankYou({
      to: "customer@example.com",
      customerName: "First Customer",
      orderSummary: "1 x Classic Country Loaf",
      deliveryWindow: "Sunday, Aug 2, 3:00 PM-6:00 PM",
      orderId: "11111111-1111-4111-8111-111111111111",
    });

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "customer@example.com",
        subject: "Thank you for your sourdough order",
        text: expect.stringContaining(
          "https://example.com/review/luna-and-lorelai",
        ),
        html: expect.stringContaining(
          'href="https://example.com/review/luna-and-lorelai"',
        ),
      }),
      {
        idempotencyKey:
          "completion-thank-you:11111111-1111-4111-8111-111111111111",
      },
    );
    expect(sendMock.mock.calls[0]?.[0]?.html).toContain("Leave a review");
    expect(sendMock.mock.calls[0]?.[0]?.html).toContain(emailLogoMarkup);
    expect(sendMock.mock.calls[0]?.[0]?.text).toContain(
      "Your honest feedback helps our small local bakery grow.",
    );
  });

  it("uses a deterministic Bread Club event key without recipient PII", async () => {
    process.env.RESEND_API_KEY = "test-key";
    sendMock.mockResolvedValue({ data: { id: "email_welcome" }, error: null });

    await sendBreadClubWelcome({
      to: "member@example.com",
      customerName: "Bread Club Member",
      membershipId: "33333333-3333-4333-8333-333333333333",
      planName: "Sunday Bread Club",
      recurringTotalCents: 8000,
      sundayLabels: ["Aug 9", "Aug 16", "Aug 23", "Aug 30"],
      manageUrl: "https://www.landlsourdough.com/bread-club/manage",
      eventKey: "paid-cycle:44444444-4444-4444-8444-444444444444:welcome",
    });

    expect(sendMock.mock.calls[0]?.[1]).toEqual({
      idempotencyKey:
        "bread-club:bread_club_welcome:paid-cycle:44444444-4444-4444-8444-444444444444:welcome",
    });
    expect(sendMock.mock.calls[0]?.[1]?.idempotencyKey).not.toContain(
      "member@example.com",
    );
  });

  it("falls back to a pre-addressed review email when no public URL exists", () => {
    expect(getBakeryReviewUrl()).toMatch(
      /^mailto:orders@landlsourdough\.com\?subject=/,
    );
    expect(getBakeryReviewUrl("javascript:alert(1)")).toMatch(
      /^mailto:orders@landlsourdough\.com\?subject=/,
    );
  });
});
