import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  insertedRows: [] as Array<Record<string, unknown>>,
  sendOwnerAlert: vi.fn(),
}));

vi.mock("./supabase", () => ({
  getSupabaseAdminClient: () => ({
    from: mocks.from,
  }),
}));

vi.mock("./owner-alerts", () => ({
  sendOwnerAlert: mocks.sendOwnerAlert,
}));

import {
  bakeNotifySignupSchema,
  buildBakeNotifySignupBody,
  buildCustomerQuestionBody,
  createCustomerQuestionMessage,
} from "./customer-messages";

beforeEach(() => {
  mocks.from.mockReset();
  mocks.insertedRows.length = 0;
  mocks.sendOwnerAlert.mockReset();
  mocks.sendOwnerAlert.mockResolvedValue(undefined);
  mocks.from.mockImplementation((table: string) => {
    if (table !== "customer_messages") {
      throw new Error(`Unexpected table ${table}`);
    }

    return {
      insert: (row: Record<string, unknown>) => {
        mocks.insertedRows.push(row);
        return {
          select: () => ({
            single: async () => ({
              data: {
                id: "00000000-0000-4000-8000-000000000001",
                order_id: null,
                customer_email: null,
                subject: row.subject,
                body: row.body,
                status: row.status,
                created_at: "2026-07-27T12:00:00.000Z",
              },
              error: null,
            }),
          }),
        };
      },
    };
  });
});

describe("bake notification signup", () => {
  it("allows a blank ZIP or a 5-digit ZIP", () => {
    expect(
      bakeNotifySignupSchema.safeParse({
        email: "customer@example.com",
        postalCode: "",
      }).success,
    ).toBe(true);

    const parsed = bakeNotifySignupSchema.safeParse({
      email: "customer@example.com",
      postalCode: " 30114 ",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.postalCode).toBe("30114");
    }
  });

  it("rejects invalid signup ZIPs with customer-specific feedback", () => {
    const parsed = bakeNotifySignupSchema.safeParse({
      email: "customer@example.com",
      postalCode: "Canton",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe(
        "Enter a 5-digit ZIP code or leave it blank.",
      );
    }
  });

  it("stores normalized signup details for owner follow-up", () => {
    expect(
      buildBakeNotifySignupBody({
        email: " Customer@Example.com ",
        postalCode: "30114",
        preference: "Next weekly bake menu",
        source: "homepage",
      }),
    ).toContain("Email: customer@example.com\nZIP: 30114");
  });

  it("formats customer chat questions for the admin inbox", () => {
    expect(
      buildCustomerQuestionBody({
        question: "Do you deliver to Woodstock?",
        answer: "Yes, 30188 and 30189 are covered.",
        source: "customer chat",
      }),
    ).toContain(
      "Question: Do you deliver to Woodstock?\nSource: customer chat\nAnswer shown: Yes, 30188 and 30189 are covered.",
    );
  });

  it("records answered AI chats as handled without notifying the owner", async () => {
    const message = await createCustomerQuestionMessage({
      question: "Do you deliver to Woodstock?",
      answer: "Yes. Enter your full address for an exact delivery check.",
      source: "customer chat",
    });

    expect(mocks.insertedRows).toEqual([
      expect.objectContaining({
        subject: "Customer question from website chat",
        status: "handled",
      }),
    ]);
    expect(message?.status).toBe("handled");
    expect(mocks.sendOwnerAlert).not.toHaveBeenCalled();
  });

  it("keeps unanswered chat records reviewable without sending a text alert", async () => {
    const message = await createCustomerQuestionMessage({
      question: "Can Grace make a custom loaf?",
      source: "customer chat",
    });

    expect(mocks.insertedRows[0]).toEqual(
      expect.objectContaining({ status: "new" }),
    );
    expect(message?.status).toBe("new");
    expect(mocks.sendOwnerAlert).not.toHaveBeenCalled();
  });
});
