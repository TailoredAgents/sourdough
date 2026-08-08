import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getBakeryReviewUrl,
  getMissingResendEmailError,
  sendOrderCompletionThankYou,
  sendOwnerShortAlert,
} from "./email";

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
}));

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
    );
    expect(sendMock.mock.calls[0]?.[0]?.html).toContain("Leave a review");
    expect(sendMock.mock.calls[0]?.[0]?.text).toContain(
      "Your honest feedback helps our small local bakery grow.",
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
