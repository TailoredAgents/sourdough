import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSentEmailEventState: vi.fn(),
  hasSentEmailEvent: vi.fn(),
  sendOwnerShortAlert: vi.fn(),
}));

vi.mock("./email", () => ({
  getSentEmailEventState: mocks.getSentEmailEventState,
  hasSentEmailEvent: mocks.hasSentEmailEvent,
  sendOwnerShortAlert: mocks.sendOwnerShortAlert,
}));

import {
  buildOwnerSmsAlertParts,
  sendOwnerAlert,
} from "./owner-alerts";

const originalEnv = { ...process.env };
const recipient = "4703880184@vtext.com";

beforeEach(() => {
  process.env.OWNER_ALERTS_ENABLED = "true";
  process.env.OWNER_ALERT_SMS_EMAIL = recipient;
  delete process.env.OWNER_ALERT_EMAIL;
  mocks.getSentEmailEventState.mockReset();
  mocks.hasSentEmailEvent.mockReset();
  mocks.sendOwnerShortAlert.mockReset();
  mocks.getSentEmailEventState.mockResolvedValue({
    hasLegacyEvent: false,
    eventKeys: [],
  });
  mocks.hasSentEmailEvent.mockResolvedValue(false);
  mocks.sendOwnerShortAlert.mockResolvedValue({ data: { id: "email_123" } });
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("owner SMS alert delivery", () => {
  it("retries only missing parts after a temporary send failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const input = {
      type: "order" as const,
      customerName: "Jane Smith",
      orderSummary:
        "2 x Classic Country Loaf\n1 x Cinnamon Swirl Sourdough",
      notes: Array.from(
        { length: 40 },
        (_, index) => `instruction-${index + 1}`,
      ).join(" "),
      orderId: "order-123",
      throwOnFailure: true,
    };
    const parts = buildOwnerSmsAlertParts(input, recipient);
    expect(parts.length).toBeGreaterThan(1);

    mocks.sendOwnerShortAlert
      .mockResolvedValueOnce({ data: { id: "email_1" } })
      .mockRejectedValueOnce(new Error("Temporary gateway failure"));

    await expect(sendOwnerAlert(input)).rejects.toThrow(
      "1 owner alert failed to send.",
    );

    mocks.sendOwnerShortAlert.mockReset();
    mocks.sendOwnerShortAlert.mockResolvedValue({
      data: { id: "email_retry" },
    });
    mocks.getSentEmailEventState.mockResolvedValue({
      hasLegacyEvent: false,
      eventKeys: [parts[0].eventKey],
    });

    await sendOwnerAlert(input);

    expect(mocks.sendOwnerShortAlert).toHaveBeenCalledTimes(parts.length - 1);
    expect(
      mocks.sendOwnerShortAlert.mock.calls.map(([call]) => call.eventKey),
    ).toEqual(parts.slice(1).map((part) => part.eventKey));
  });

  it("does not resend orders recorded by the previous alert format", async () => {
    mocks.getSentEmailEventState.mockResolvedValue({
      hasLegacyEvent: true,
      eventKeys: [],
    });

    await sendOwnerAlert({
      type: "order",
      customerName: "Jane Smith",
      orderSummary: "1 x Classic Country Loaf",
      notes: "Leave on porch",
      orderId: "legacy-order",
    });

    expect(mocks.sendOwnerShortAlert).not.toHaveBeenCalled();
  });
});
