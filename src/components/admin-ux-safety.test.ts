import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DeliverySettings } from "@/lib/delivery";
import type { DeliveryWindow, WeeklyMenu, WeeklyMenuSummary } from "@/lib/types";
import {
  AdminDashboard,
  getAdminWeekSwitchConfirmation,
  isCurrentSundayRouteRequest,
} from "./admin-dashboard";
import {
  DeliveryEditor,
  getDeliverySwitchConfirmation,
} from "./delivery-editor";
import { getWeeklyMenuSwitchConfirmation } from "./weekly-menu-editor";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

const sunday: WeeklyMenu = {
  id: "sunday-a",
  name: "Sunday, August 9",
  orderCutoffAt: "2026-08-07T16:00:00.000Z",
  startsAt: "2026-08-09T19:00:00.000Z",
  endsAt: "2026-08-09T22:00:00.000Z",
  published: true,
  items: [],
};

const sundaySummary: WeeklyMenuSummary = {
  id: sunday.id,
  name: sunday.name,
  orderCutoffAt: sunday.orderCutoffAt,
  startsAt: sunday.startsAt,
  endsAt: sunday.endsAt,
  published: sunday.published,
  itemCount: 0,
};

const deliverySettings: DeliverySettings = {
  center: { lat: 34.2368, lng: -84.4908 },
  radiusMiles: 25,
  deliveryFeeCents: 500,
  allowedPostalCodes: ["30114"],
  serviceAreaCopy: "Sunday delivery around Canton.",
};

const reservedWindow: DeliveryWindow = {
  id: "window-a",
  weeklyMenuId: sunday.id,
  label: "Sunday afternoon",
  startsAt: "2026-08-09T19:00:00.000Z",
  endsAt: "2026-08-09T22:00:00.000Z",
  capacity: 8,
  reserved: 2,
};

describe("admin Sunday-switch safety", () => {
  it("uses one combined confirmation when both editors have unsaved work", () => {
    expect(getAdminWeekSwitchConfirmation(false, false)).toBeNull();
    expect(getAdminWeekSwitchConfirmation(true, true)).toBe(
      "You have unsaved weekly-menu and delivery edits. Switch Sundays and discard both?",
    );
  });

  it("only asks for confirmation when weekly-menu edits are dirty", () => {
    expect(getWeeklyMenuSwitchConfirmation(false)).toBeNull();
    expect(getWeeklyMenuSwitchConfirmation(true)).toBe(
      "You have unsaved weekly-menu edits. Switch Sundays and discard those changes?",
    );
  });

  it("only asks for confirmation when delivery edits are dirty", () => {
    expect(getDeliverySwitchConfirmation(false)).toBeNull();
    expect(getDeliverySwitchConfirmation(true)).toBe(
      "You have unsaved delivery edits. Switch Sundays and discard those changes?",
    );
  });

  it("rejects an old Sunday A route after Sunday B is selected", () => {
    expect(isCurrentSundayRouteRequest("sunday-a", 1, "sunday-b", 2)).toBe(
      false,
    );
    expect(isCurrentSundayRouteRequest("sunday-a", 1, "sunday-a", 2)).toBe(
      false,
    );
    expect(isCurrentSundayRouteRequest("sunday-b", 2, "sunday-b", 2)).toBe(
      true,
    );
  });
});

describe("admin Sunday controls", () => {
  it("puts the shared Sunday selector first on mobile and explains its scope", () => {
    const html = renderToStaticMarkup(
      React.createElement(AdminDashboard, {
        aiKnowledgeEntries: [],
        customerMessages: [],
        customerMessagesHasMore: false,
        customerMessagesTotal: 0,
        deliverySettings,
        deliveryWindows: [reservedWindow],
        menu: [],
        orderingWeeks: [],
        orders: [],
        products: [],
        weeklyMenu: sunday,
        weeklyMenus: [sundaySummary],
      }),
    );

    expect(html).toContain('class="order-1 grid gap-2 sm:order-2 sm:min-w-72"');
    expect(html).toContain('aria-label="Work Sunday"');
    expect(html).toContain(
      "This Sunday drives the orders, menu, delivery, and route below.",
    );
    expect(html).toContain('class="order-2 sm:order-1"');
    expect(html).toContain("Today&#x27;s 1-2-3");
  });

  it("locks reserved slot identity and times while keeping capacity editable", () => {
    const html = renderToStaticMarkup(
      React.createElement(DeliveryEditor, {
        initialDeliverySettings: deliverySettings,
        initialDeliveryWindows: [reservedWindow],
        onSelectedWeeklyMenuIdChange: () => undefined,
        selectedWeeklyMenuId: sunday.id,
        weeklyMenus: [sundaySummary],
      }),
    );

    expect(html).toContain(
      "This slot has reserved orders, so its customer label and times are locked",
    );
    expect(html).toContain(
      "Capacity may still change, but it cannot be lower than 2 reserved.",
    );

    const labelInput = html.match(
      /<input[^>]*aria-label="Sunday delivery label for Sunday afternoon"[^>]*>/,
    )?.[0];
    const startInput = html.match(
      /<input[^>]*aria-label="Sunday afternoon start time"[^>]*>/,
    )?.[0];
    const capacityInput = html.match(
      /<input[^>]*aria-label="Sunday afternoon capacity"[^>]*>/,
    )?.[0];

    expect(labelInput).toContain("disabled");
    expect(startInput).toContain("disabled");
    expect(capacityInput).toContain('min="2"');
    expect(capacityInput).not.toContain("disabled");
  });
});
