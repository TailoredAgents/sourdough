import { describe, expect, it } from "vitest";
import {
  buildMailtoHref,
  buildMapSearchHref,
  buildTelHref,
  formatDeliveryAddress,
} from "./admin-contact-links";

const address = {
  line1: "101 Main Street",
  line2: "Suite 4",
  city: "Woodstock",
  state: "GA",
  postalCode: "30188",
};

describe("admin contact links", () => {
  it("builds mailto links with optional encoded subjects", () => {
    expect(buildMailtoHref(" customer@example.com ")).toBe(
      "mailto:customer@example.com",
    );
    expect(buildMailtoHref("customer@example.com", "Order #123 follow up")).toBe(
      "mailto:customer@example.com?subject=Order%20%23123%20follow%20up",
    );
    expect(buildMailtoHref("   ")).toBeNull();
    expect(buildMailtoHref(null)).toBeNull();
  });

  it("builds phone links from readable customer phone numbers", () => {
    expect(buildTelHref("(470) 388-0184")).toBe("tel:+14703880184");
    expect(buildTelHref("1-470-388-0184")).toBe("tel:+14703880184");
    expect(buildTelHref("555-1212")).toBe("tel:5551212");
    expect(buildTelHref("123")).toBeNull();
    expect(buildTelHref(null)).toBeNull();
  });

  it("formats delivery addresses for display and maps", () => {
    expect(formatDeliveryAddress(address)).toBe(
      "101 Main Street, Suite 4, Woodstock, GA 30188",
    );
    expect(buildMapSearchHref(address)).toBe(
      "https://www.google.com/maps/search/?api=1&query=101%20Main%20Street%2C%20Suite%204%2C%20Woodstock%2C%20GA%2030188",
    );
    expect(buildMapSearchHref(" 101 Main Street Woodstock GA ")).toBe(
      "https://www.google.com/maps/search/?api=1&query=101%20Main%20Street%20Woodstock%20GA",
    );
    expect(buildMapSearchHref("")).toBeNull();
    expect(buildMapSearchHref(null)).toBeNull();
  });
});
