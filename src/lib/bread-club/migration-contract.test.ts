import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260726090000_bread_club.sql",
  "utf8",
);
const pgcryptoMigration = readFileSync(
  "supabase/migrations/20260727020000_bread_club_pgcrypto_search_path.sql",
  "utf8",
);
const schema = readFileSync("supabase/schema.sql", "utf8");

describe("Bread Club transactional migration contract", () => {
  it("enforces unique member weeks, invoices, events, and source references", () => {
    expect(migration).toContain("unique (membership_id, weekly_menu_id)");
    expect(migration).toContain("stripe_invoice_id text unique");
    expect(migration).toContain("create table if not exists processed_stripe_events");
    expect(migration).toContain("token_hash text not null unique");
    expect(migration).toContain("session_hash text not null unique");
  });

  it("serializes the ten-loaf cap and reserves inventory inside one RPC", () => {
    const reservation = migration.slice(
      migration.indexOf("create or replace function reserve_bread_club_cycle"),
      migration.indexOf("create or replace function activate_bread_club_cycle"),
    );
    expect(reservation).toContain("from bread_club_settings");
    expect(reservation).toContain("for update");
    expect(reservation).toContain(
      "bread_club_weekly_loaf_slots(v_menu_id) + plan_row.loaves_per_week",
    );
    expect(reservation).toContain(
      "> settings_row.max_weekly_loaf_slots",
    );
    expect(reservation).toContain("update weekly_menu_items menu_item");
    expect(reservation).toContain("update delivery_windows");
    expect(reservation).toContain("insert into bread_club_fulfillments");
    expect(reservation).toContain("insert into orders");
    expect(reservation).toContain(
      "weekly_subtotal := cycle_row.plan_price_cents / 4",
    );
    expect(reservation).not.toContain(
      "reserve_bread_club_cycle.product_id",
    );
  });

  it("resolves pgcrypto from Supabase's extensions schema", () => {
    expect(migration).toContain("extensions.gen_random_bytes(24)");
    expect(schema).toContain("extensions.gen_random_bytes(24)");
    expect(pgcryptoMigration).toContain(
      "set search_path = public, extensions",
    );
    expect(pgcryptoMigration).toContain(
      "to_regprocedure('extensions.gen_random_bytes(integer)')",
    );
  });

  it("releases inventory on skips and creates a 60-day configured credit", () => {
    const skip = migration.slice(
      migration.indexOf("create or replace function skip_bread_club_fulfillment"),
      migration.indexOf("create or replace function redeem_bread_club_credit"),
    );
    expect(skip).toContain("perform release_order_inventory");
    expect(skip).toContain("skip_count >= settings_row.skip_limit_per_cycle");
    expect(skip).toContain("make_interval(days => settings_row.rollover_credit_days)");
    expect(skip).toContain("status = 'paid'");
    expect(skip).toContain("redeemed_fulfillment_id = fulfillment_row.id");
  });

  it("keeps paid add-ons and rollover quantities when changing the base loaf", () => {
    const swap = migration.slice(
      migration.indexOf("create or replace function swap_bread_club_selection"),
      migration.indexOf("create or replace function update_bread_club_address"),
    );
    expect(swap).toContain(
      "jsonb_array_elements(fulfillment_row.selection)",
    );
    expect(swap).toContain("cycle_row.plan_price_cents");
    expect(swap).toContain("quantity = quantity - previous_quantity");
    expect(swap).not.toContain(
      "delete from order_items\n  where order_items.order_id = v_order_id",
    );
  });

  it("prevents a refunded cycle from leaving reusable credits", () => {
    const refund = migration.slice(
      migration.indexOf("create or replace function refund_bread_club_cycle"),
      migration.indexOf("create or replace function swap_bread_club_selection"),
    );
    expect(refund).toContain("credit.status = 'redeemed'");
    expect(refund).toContain("credit.delivery_credit_applied_at is not null");
    expect(refund).toContain("credit.status in ('available', 'expired')");
    expect(refund).toContain("set status = 'refunded'");
  });

  it("locks an eligible cycle before an external Stripe refund", () => {
    const refundStart = migration.slice(
      migration.indexOf(
        "create or replace function begin_bread_club_cycle_refund",
      ),
      migration.indexOf("create or replace function refund_bread_club_cycle"),
    );
    expect(refundStart).toContain("for update");
    expect(refundStart).toContain("status = 'refund_pending'");
    expect(refundStart).toContain(
      "bakery_order.status in ('baking', 'out_for_delivery', 'delivered')",
    );
    expect(migration).toContain(
      "grant execute on function begin_bread_club_cycle_refund(uuid)",
    );
  });

  it("exposes transactional RPCs only to the server service role", () => {
    expect(migration).toContain(
      "revoke all on function reserve_bread_club_cycle(uuid, uuid, jsonb)",
    );
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain(
      "grant execute on function reserve_bread_club_cycle(uuid, uuid, jsonb)",
    );
    expect(migration).toContain("to service_role");
  });

  it("keeps fresh-install status and value constraints aligned", () => {
    const constraints = [
      "status in (\n        'pending_checkout'",
      "status in (\n        'pending_payment',\n        'paid'",
      "status in (\n        'pending_payment',\n        'scheduled'",
      "status in ('available', 'redeemed', 'expired', 'refunded')",
      "status in ('pending_payment', 'paid', 'expired', 'canceled', 'refunded')",
      "status in ('processing', 'processed', 'failed')",
      "pending_route_fee_cents is null or pending_route_fee_cents >= 0",
      "attempt_count > 0",
    ];

    for (const constraint of constraints) {
      expect(migration).toContain(constraint);
      expect(schema).toContain(constraint);
    }
  });
});
