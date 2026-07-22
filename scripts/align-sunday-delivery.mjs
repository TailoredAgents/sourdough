import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

const TIME_ZONE = "America/New_York";
const DEFAULT_CAPACITY = 20;
const EXECUTE = process.argv.includes("--execute");
const RESERVED_STATUSES = new Set(["pending_payment", "paid", "baking", "out_for_delivery"]);
const UNPAID_STATUSES = new Set(["pending_payment", "pending_approval_payment"]);

function loadLocalEnv() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function getParts(date) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    weekday: String(values.weekday || ""),
    hour: Number(values.hour) === 24 ? 0 : Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function zonedDateToUtc({ year, month, day, hour, minute }) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  const actual = getParts(guess);
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const actualUtc = Date.UTC(
    actual.year,
    actual.month - 1,
    actual.day,
    actual.hour,
    actual.minute,
    actual.second,
    0,
  );
  return new Date(guess.getTime() + (desiredUtc - actualUtc));
}

function addLocalDays(date, days) {
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

function atLocal(date, hour, minute) {
  return zonedDateToUtc({ ...date, hour, minute });
}

function weekStartFor(date) {
  const parts = getParts(date);
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    parts.weekday,
  );
  return addLocalDays(parts, weekdayIndex === 0 ? -6 : 1 - weekdayIndex);
}

function scheduleForDate(date) {
  const monday = weekStartFor(date);
  const friday = addLocalDays(monday, 4);
  const sunday = addLocalDays(monday, 6);
  return {
    startsAt: atLocal(monday, 0, 0),
    endsAt: atLocal(sunday, 23, 59),
    orderCutoffAt: atLocal(friday, 0, 0),
    deliveryStartsAt: atLocal(sunday, 15, 0),
    deliveryEndsAt: atLocal(sunday, 18, 0),
  };
}

function formatWindowLabel(startsAt, endsAt) {
  const day = new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: TIME_ZONE,
  }).format(startsAt);
  const time = new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  });
  return `${day}, ${time.format(startsAt)}-${time.format(endsAt)}`;
}

async function must(result, message) {
  const resolved = await result;
  if (resolved.error) throw new Error(`${message}: ${resolved.error.message}`);
  return resolved.data;
}

async function main() {
  loadLocalEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("Supabase URL and service role key are required.");
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const now = new Date();
  const menuRows = await must(
    supabase
      .from("weekly_menus")
      .select("id, name, order_cutoff_at, starts_at, ends_at, published")
      .eq("published", true)
      .gte("ends_at", now.toISOString())
      .order("starts_at", { ascending: true }),
    "Future menu lookup failed",
  );
  const futureWindows = await must(
    supabase
      .from("delivery_windows")
      .select("id, weekly_menu_id, starts_at, ends_at")
      .gte("ends_at", now.toISOString())
      .order("starts_at", { ascending: true }),
    "Future window lookup failed",
  );
  const menuIds = Array.from(
    new Set([
      ...(menuRows || []).map((menu) => menu.id),
      ...(futureWindows || []).map((window) => window.weekly_menu_id).filter(Boolean),
    ]),
  );
  const menus = menuIds.length
    ? await must(
        supabase
          .from("weekly_menus")
          .select("id, name, order_cutoff_at, starts_at, ends_at, published")
          .in("id", menuIds)
          .order("starts_at", { ascending: true }),
        "Window-backed menu lookup failed",
      )
    : [];

  const report = [];
  for (const menu of menus || []) {
    const referenceWindow = (futureWindows || []).find(
      (window) => window.weekly_menu_id === menu.id,
    );
    const referenceDate = new Date(referenceWindow?.starts_at || menu.ends_at);
    const schedule = scheduleForDate(referenceDate);
    const label = formatWindowLabel(schedule.deliveryStartsAt, schedule.deliveryEndsAt);
    const windows = await must(
      supabase
        .from("delivery_windows")
        .select("id, label, starts_at, ends_at, capacity, reserved")
        .eq("weekly_menu_id", menu.id),
      "Delivery window lookup failed",
    );
    const target = (windows || []).find(
      (window) =>
        new Date(window.starts_at).getTime() === schedule.deliveryStartsAt.getTime() &&
        new Date(window.ends_at).getTime() === schedule.deliveryEndsAt.getTime(),
    );
    const oldWindows = (windows || []).filter((window) => window.id !== target?.id);
    const oldWindowIds = oldWindows.map((window) => window.id);
    const oldOrders = oldWindowIds.length
      ? await must(
          supabase
            .from("orders")
            .select("id, status, delivery_window_id")
            .in("delivery_window_id", oldWindowIds),
          "Old-window order lookup failed",
        )
      : [];

    report.push({
      menu: menu.name,
      sundayWindow: label,
      oldWindowCount: oldWindows.length,
      oldOrderCount: oldOrders.length,
      unpaidToCancel: oldOrders.filter((order) => UNPAID_STATUSES.has(order.status)).length,
      paidOrHistoricalToReassign: oldOrders.filter(
        (order) => !UNPAID_STATUSES.has(order.status),
      ).length,
    });

    if (!EXECUTE) continue;

    await must(
      supabase
        .from("weekly_menus")
        .update({
          order_cutoff_at: schedule.orderCutoffAt.toISOString(),
          starts_at: schedule.startsAt.toISOString(),
          ends_at: schedule.endsAt.toISOString(),
        })
        .eq("id", menu.id),
      "Menu schedule update failed",
    );

    let targetId = target?.id;
    if (targetId) {
      await must(
        supabase
          .from("delivery_windows")
          .update({
            label,
            starts_at: schedule.deliveryStartsAt.toISOString(),
            ends_at: schedule.deliveryEndsAt.toISOString(),
            capacity: Math.max(Number(target.capacity || 0), DEFAULT_CAPACITY),
          })
          .eq("id", targetId),
        "Sunday window update failed",
      );
    } else {
      const created = await must(
        supabase
          .from("delivery_windows")
          .insert({
            weekly_menu_id: menu.id,
            label,
            starts_at: schedule.deliveryStartsAt.toISOString(),
            ends_at: schedule.deliveryEndsAt.toISOString(),
            capacity: DEFAULT_CAPACITY,
            reserved: 0,
          })
          .select("id")
          .single(),
        "Sunday window creation failed",
      );
      targetId = created.id;
    }

    for (const order of oldOrders || []) {
      if (UNPAID_STATUSES.has(order.status)) {
        if (order.status === "pending_payment") {
          await must(
            supabase.rpc("release_order_inventory", { p_order_id: order.id }),
            "Pending order inventory release failed",
          );
        }
        await must(
          supabase
            .from("orders")
            .update({
              status: "canceled",
              delivery_window_id: targetId,
              admin_decision_note:
                "Canceled during Sunday delivery alignment before payment completed.",
              updated_at: new Date().toISOString(),
            })
            .eq("id", order.id),
          "Pending order cancel failed",
        );
      } else {
        await must(
          supabase
            .from("orders")
            .update({
              delivery_window_id: targetId,
              admin_decision_note:
                "Delivery moved to the Sunday 3:00-6:00 PM slot during schedule alignment.",
              updated_at: new Date().toISOString(),
            })
            .eq("id", order.id),
          "Paid/historical order reassignment failed",
        );
      }
    }

    const activeOrders = await must(
      supabase
        .from("orders")
        .select("id, status")
        .eq("delivery_window_id", targetId),
      "Sunday-window order recount failed",
    );
    const reserved = (activeOrders || []).filter((order) =>
      RESERVED_STATUSES.has(order.status),
    ).length;
    await must(
      supabase
        .from("delivery_windows")
        .update({ reserved })
        .eq("id", targetId),
      "Sunday reserved-count update failed",
    );

    if (oldWindowIds.length) {
      await must(
        supabase.from("delivery_windows").delete().in("id", oldWindowIds),
        "Old window cleanup failed",
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: EXECUTE ? "execute" : "dry-run",
        checkedMenus: report.length,
        report,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
