import { describe, expect, it } from "vitest";
import { BREAD_CLUB_WEBHOOK_EVENTS } from "./stripe-sync";

describe("Bread Club Stripe webhook configuration", () => {
  it("subscribes to delayed Checkout payment outcomes", () => {
    expect(BREAD_CLUB_WEBHOOK_EVENTS).toEqual(
      expect.arrayContaining([
        "checkout.session.async_payment_succeeded",
        "checkout.session.async_payment_failed",
      ]),
    );
  });
});
