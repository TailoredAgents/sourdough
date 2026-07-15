import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMissingResendEmailError, sendOwnerShortAlert } from "./email";

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

beforeEach(() => {
  sendMock.mockReset();
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
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
});
