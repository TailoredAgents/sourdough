import { describe, expect, it } from "vitest";
import {
  getCustomerMessageReplyWarning,
  hasAdminMessageDetails,
  parseAdminMessageDetails,
  summarizeCustomerMessages,
} from "./admin-message-details";
import type { CustomerMessage } from "./types";

const message: CustomerMessage = {
  id: "message-1",
  orderId: null,
  customerEmail: "customer@example.com",
  subject: "Last-minute request from Jordan",
  body: "",
  status: "new",
  createdAt: "2026-07-15T12:00:00.000Z",
};

describe("admin message details", () => {
  it("parses last-minute request bodies into owner-facing details", () => {
    expect(
      parseAdminMessageDetails([
        "Customer: Jordan Baker",
        "Email: jordan@example.com",
        "Phone: 470-555-1212",
        "",
        "Requested items:",
        "2 x Classic Country Loaf",
        "1 x Honey Butter",
        "",
        "Preferred delivery window: Wednesday, 3:00-6:00 PM",
        "Address: 101 Main St, Woodstock, GA 30188",
        "Delivery instructions: Leave at porch",
        "",
        "Notes: Please text before arrival",
      ].join("\n")),
    ).toMatchObject({
      customerName: "Jordan Baker",
      email: "jordan@example.com",
      phone: "470-555-1212",
      requestedItems: ["2 x Classic Country Loaf", "1 x Honey Butter"],
      deliveryWindow: "Wednesday, 3:00-6:00 PM",
      address: "101 Main St, Woodstock, GA 30188",
      deliveryInstructions: "Leave at porch",
      notes: "Please text before arrival",
    });
  });

  it("parses signup and chat-question details", () => {
    expect(
      parseAdminMessageDetails(
        "Email: customer@example.com\nZIP: 30114\nInterest: Weekly menu alerts",
      ),
    ).toMatchObject({
      email: "customer@example.com",
      zip: "30114",
      interest: "Weekly menu alerts",
    });

    expect(
      parseAdminMessageDetails(
        "Question: Do you deliver to Woodstock?\nSource: customer chat\nAnswer shown: Yes.",
      ),
    ).toMatchObject({
      question: "Do you deliver to Woodstock?",
      source: "customer chat",
      answerShown: "Yes.",
    });
  });

  it("detects whether a message body has structured owner details", () => {
    expect(hasAdminMessageDetails(parseAdminMessageDetails("Plain customer note"))).toBe(
      false,
    );
    expect(hasAdminMessageDetails(parseAdminMessageDetails("Phone: 470-555-1212"))).toBe(
      true,
    );
  });

  it("warns when a selected message cannot receive a direct reply", () => {
    expect(getCustomerMessageReplyWarning(message)).toBeNull();
    expect(
      getCustomerMessageReplyWarning({
        ...message,
        customerEmail: null,
      }),
    ).toContain("does not include a customer email");
  });

  it("summarizes request inbox state", () => {
    expect(
      summarizeCustomerMessages([
        message,
        { ...message, id: "message-2", status: "in_progress", customerEmail: null },
        { ...message, id: "message-3", status: "handled" },
      ]),
    ).toEqual({
      new: 1,
      inProgress: 1,
      handled: 1,
      noEmail: 1,
    });
  });
});
