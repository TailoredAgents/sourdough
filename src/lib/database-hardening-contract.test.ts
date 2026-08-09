import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("supabase/schema.sql", "utf8");
const hardeningMigration = readFileSync(
  "supabase/migrations/20260808090000_webhook_inventory_hardening.sql",
  "utf8",
);
const adminCommandsMigration = readFileSync(
  "supabase/migrations/20260808093000_admin_order_commands.sql",
  "utf8",
);
const rateLimitMigration = readFileSync(
  "supabase/migrations/20260808094500_atomic_rate_limits.sql",
  "utf8",
);
const claimLeaseMigration = readFileSync(
  "supabase/migrations/20260808100000_webhook_claim_leases.sql",
  "utf8",
);
const refundFinalizeMigration = readFileSync(
  "supabase/migrations/20260808101500_admin_refund_finalize.sql",
  "utf8",
);
const checkoutStateMigration = readFileSync(
  "supabase/migrations/20260808103000_checkout_state_machine.sql",
  "utf8",
);
const notificationOutboxMigration = readFileSync(
  "supabase/migrations/20260808104500_order_notification_outbox.sql",
  "utf8",
);
const configurationCommandsMigration = readFileSync(
  "supabase/migrations/20260808110000_admin_configuration_commands.sql",
  "utf8",
);
const productCommandMigration = readFileSync(
  "supabase/migrations/20260808111500_admin_product_command.sql",
  "utf8",
);
const checkoutCreationMigration = readFileSync(
  "supabase/migrations/20260808113000_atomic_checkout_creation.sql",
  "utf8",
);
const breadClubCheckoutBoundaryMigration = readFileSync(
  "supabase/migrations/20260808114500_bread_club_checkout_boundaries.sql",
  "utf8",
);
const adminPaymentFenceMigration = readFileSync(
  "supabase/migrations/20260808120000_admin_payment_fences.sql",
  "utf8",
);
const rollingWeekMigration = readFileSync(
  "supabase/migrations/20260808121500_atomic_rolling_week.sql",
  "utf8",
);
const magicLinkExchangeMigration = readFileSync(
  "supabase/migrations/20260808122000_atomic_magic_link_exchange.sql",
  "utf8",
);
const renewalCycleMigration = readFileSync(
  "supabase/migrations/20260808124500_atomic_bread_club_renewal_cycle.sql",
  "utf8",
);
const breadClubRefundFenceMigration = readFileSync(
  "supabase/migrations/20260808130000_bread_club_refund_fences.sql",
  "utf8",
);
const breadClubProviderSyncMigration = readFileSync(
  "supabase/migrations/20260808131500_bread_club_provider_sync.sql",
  "utf8",
);
const adminOrderScopeMigration = readFileSync(
  "supabase/migrations/20260808132000_admin_order_scope_fences.sql",
  "utf8",
);
const schemaHealthV2Migration = readFileSync(
  "supabase/migrations/20260808133000_operational_schema_health_v2.sql",
  "utf8",
);
const publicTableWriteGrantMigration = readFileSync(
  "supabase/migrations/20260808134500_public_table_write_grants.sql",
  "utf8",
);
const schemaHealthMigration = readFileSync(
  "supabase/migrations/20260808140000_operational_schema_health_v3.sql",
  "utf8",
);
const weeklyMenuRoute = readFileSync(
  "src/app/api/admin/weekly-menu/route.ts",
  "utf8",
);
const deliveryRoute = readFileSync(
  "src/app/api/admin/delivery/route.ts",
  "utf8",
);
const productRoute = readFileSync(
  "src/app/api/admin/products/route.ts",
  "utf8",
);

describe("database hardening contract", () => {
  it("keeps storefront inventory RPCs restricted to the service role", () => {
    for (const sql of [schema, hardeningMigration]) {
      expect(sql).toContain(
        "revoke all on function public.reserve_order_inventory(uuid, jsonb)",
      );
      expect(sql).toContain(
        "revoke all on function public.release_order_inventory(uuid)",
      );
      expect(sql).toContain("from public, anon, authenticated");
      expect(sql).toContain(
        "grant execute on function public.reserve_order_inventory(uuid, jsonb)",
      );
      expect(sql).toContain("to service_role");
    }
  });

  it("reclaims abandoned Stripe events with fenced lease tokens", () => {
    for (const sql of [schema, claimLeaseMigration]) {
      expect(sql).toContain("claim_token");
      expect(sql).toContain("lease_expires_at");
      expect(sql).toContain("interval '15 minutes'");
      expect(sql).toContain("attempt_count = attempt_count + 1");
      expect(sql).toContain("p_claim_token uuid");
      expect(sql).toContain("and claim_token = p_claim_token");
    }
  });

  it("keeps the fresh-install schema aligned with Stripe tax fields", () => {
    expect(schema).toContain(
      "tax_cents integer not null default 0 check (tax_cents >= 0)",
    );
    expect(schema).toContain(
      "total_cents integer not null default 0 check (total_cents >= 0)",
    );
    expect(schema).toContain("p_tax_cents integer default 0");
    expect(schema).toContain("p_total_cents integer default null");
    expect(schema).toContain("tax_cents = tax_cents + charged_tax_cents");
  });

  it("locks and audits admin order commands inside database transactions", () => {
    for (const sql of [schema, adminCommandsMigration]) {
      expect(sql).toContain("create or replace function public.admin_transition_order_status");
      expect(sql).toContain("create or replace function public.admin_accept_approval_order");
      expect(sql).toContain("for update");
      expect(sql).toContain("insert into admin_order_events");
      expect(sql).toContain("from public, anon, authenticated");
      expect(sql).toContain("to service_role");
    }
  });

  it("enforces current availability while inventory is being reserved", () => {
    for (const sql of [schema, adminCommandsMigration]) {
      expect(sql).toContain("delivery_window.ends_at > now()");
      expect(sql).toContain("weekly_menu.published = true");
      expect(sql).toContain("menu_item.unavailable = false");
      expect(sql).toContain("product.active = true");
    }
  });

  it("serializes rate-limit buckets and keeps the RPC server-only", () => {
    for (const sql of [schema, rateLimitMigration]) {
      expect(sql).toContain("create or replace function public.consume_rate_limit");
      expect(sql).toContain("pg_catalog.pg_advisory_xact_lock");
      expect(sql).toContain(
        "revoke all on function public.consume_rate_limit(text, text, integer, integer)",
      );
      expect(sql).toContain(
        "grant execute on function public.consume_rate_limit(text, text, integer, integer)",
      );
      expect(sql).toContain("create or replace function public.cleanup_rate_limit_events");
      expect(sql).toContain("interval '31 days'");
    }
  });

  it("finalizes approval refunds once and preserves their audit trail", () => {
    for (const sql of [schema, refundFinalizeMigration]) {
      expect(sql).toContain(
        "create or replace function public.admin_finalize_approval_refund",
      );
      expect(sql).toContain("for update");
      expect(sql).toContain("'deny_approval_refund'");
      expect(sql).toContain("on delete restrict");
      expect(sql).toContain(
        "revoke all on function public.admin_finalize_approval_refund(uuid, text, text)",
      );
    }
  });

  it("serializes checkout cancellation and paid-session recovery", () => {
    for (const sql of [schema, checkoutStateMigration]) {
      expect(sql).toContain(
        "create or replace function public.cancel_storefront_checkout",
      );
      expect(sql).toContain(
        "create or replace function public.complete_storefront_checkout_payment",
      );
      expect(sql).toContain("Checkout subtotal did not match the order total");
      expect(sql).toContain("Payment completed after cancellation");
      expect(sql).toContain("perform public.release_order_inventory");
      expect(sql).toContain("perform public.reserve_order_inventory");
      expect(sql).toContain("'recover_paid_checkout'");
    }
  });

  it("enqueues completion emails transactionally and retries with leases", () => {
    for (const sql of [schema, notificationOutboxMigration]) {
      expect(sql).toContain("create table if not exists public.order_notification_jobs");
      expect(sql).toContain("enqueue_order_completion_notification");
      expect(sql).toContain("after update of status on public.orders");
      expect(sql).toContain("claim_order_notification_job");
      expect(sql).toContain("finish_order_notification_job");
      expect(sql).toContain("and claim_token = p_claim_token");
      expect(sql).toContain("from public, anon, authenticated");
    }
  });

  it("saves weekly menus and delivery configuration atomically", () => {
    for (const sql of [schema, configurationCommandsMigration]) {
      expect(sql).toContain(
        "create or replace function public.admin_save_weekly_menu",
      );
      expect(sql).toContain(
        "create or replace function public.admin_save_delivery_configuration",
      );
      expect(sql).toContain(
        "create or replace function public.admin_set_weekly_menu_item_availability",
      );
      expect(sql).toContain("delivery_windows_weekly_menu_unique_idx");
      expect(sql).toContain("America/New_York");
      expect(sql).toContain("cannot be rescheduled or relabeled");
      expect(sql).toContain("order history cannot be removed");
      expect(sql).toContain("prevents cross-editor deadlocks");
      expect(sql).toContain("for update");
      expect(sql).toContain("insert into public.admin_configuration_events");
      expect(sql).toContain("from public, anon, authenticated");
      expect(sql).toContain("to service_role");
    }

    expect(weeklyMenuRoute).toContain('.rpc(\n    "admin_save_weekly_menu"');
    expect(deliveryRoute).toContain(
      '.rpc("admin_save_delivery_configuration"',
    );
    expect(weeklyMenuRoute).toContain("p_actor_email: admin.email");
    expect(deliveryRoute).toContain("p_actor_email: admin.email");
    expect(weeklyMenuRoute).toContain(
      '.rpc("admin_set_weekly_menu_item_availability"',
    );
    expect(schema).toContain(configurationCommandsMigration.trim());
  });

  it("saves products and upcoming-menu attachment in one command", () => {
    for (const sql of [schema, productCommandMigration]) {
      expect(sql).toContain(
        "create or replace function public.admin_save_product",
      );
      expect(sql).toContain("insert into public.weekly_menu_items");
      expect(sql).toContain("insert into public.admin_configuration_events");
      expect(sql).toContain("Match admin_save_weekly_menu's lock order");
      expect(sql).toContain("from public, anon, authenticated");
      expect(sql).toContain("to service_role");
    }

    expect(productRoute).toContain('.rpc("admin_save_product"');
    expect(productRoute).toContain("p_actor_email: admin.email");
    expect(schema).toContain(productCommandMigration.trim());
  });

  it("creates checkout orders once and recovers Stripe attachment safely", () => {
    for (const sql of [schema, checkoutCreationMigration]) {
      expect(sql).toContain(
        "create or replace function public.create_storefront_checkout_order",
      );
      expect(sql).toContain("orders_checkout_attempt_id_unique_idx");
      expect(sql).toContain("storefront-checkout-attempt:");
      expect(sql).toContain(
        "Checkout attempt was already used with different order details.",
      );
      expect(sql).toContain(
        "create or replace function public.attach_storefront_checkout_session",
      );
      expect(sql).toContain(
        "create or replace function public.cleanup_abandoned_storefront_checkouts",
      );
      expect(sql).toContain("for share");
      expect(sql).toContain("for key share of product");
      expect(sql).toContain("from public, anon, authenticated");
      expect(sql).toContain("to service_role");
    }
    expect(schema).toContain(checkoutCreationMigration.trim());
  });

  it("fences Bread Club subscription and add-on checkout boundaries", () => {
    for (const sql of [schema, breadClubCheckoutBoundaryMigration]) {
      expect(sql).toContain(
        "create or replace function public.create_bread_club_subscription_checkout",
      );
      expect(sql).toContain(
        "create or replace function public.cancel_bread_club_subscription_checkout",
      );
      expect(sql).toContain(
        "create or replace function public.create_bread_club_addon_checkout",
      );
      expect(sql).toContain(
        "create or replace function public.complete_bread_club_addon_checkout_fenced",
      );
      expect(sql).toContain("bread-club-subscription-attempt:");
      expect(sql).toContain("bread-club-addon-attempt:");
      expect(sql).toContain("from public, anon, authenticated");
      expect(sql).toContain("to service_role");
    }
  });

  it("claims approval refunds before making irreversible provider calls", () => {
    for (const sql of [schema, adminPaymentFenceMigration]) {
      expect(sql).toContain("approval_refund_started_at");
      expect(sql).toContain(
        "create or replace function public.protect_claimed_approval_refund",
      );
      expect(sql).toContain(
        "create or replace function public.admin_begin_approval_refund",
      );
      expect(sql).toContain(
        "create or replace function public.admin_record_approval_refund",
      );
      expect(sql).toContain(
        "This approval request has a Stripe refund in progress.",
      );
      expect(sql).toContain("from public, anon, authenticated");
      expect(sql).toContain("to service_role");
    }
  });

  it("generates or repairs rolling weeks in one transaction", () => {
    for (const sql of [schema, rollingWeekMigration]) {
      expect(sql).toContain(
        "create or replace function public.ensure_atomic_rolling_week",
      );
      expect(sql).toContain("generation_key = trim(p_generation_key)");
      expect(sql).toContain("for update");
      expect(sql).toContain("from public, anon, authenticated");
      expect(sql).toContain("to service_role");
    }
  });

  it("exchanges Bread Club magic links atomically and server-side only", () => {
    for (const sql of [schema, magicLinkExchangeMigration]) {
      expect(sql).toContain(
        "create or replace function public.consume_bread_club_magic_link",
      );
      expect(sql).toContain("for update");
      expect(sql).toContain("insert into public.bread_club_sessions");
      expect(sql).toContain("from public, anon, authenticated");
      expect(sql).toContain("to service_role");
    }
  });

  it("keeps every terminal hardening migration in canonical order", () => {
    const terminalMigrations = [
      renewalCycleMigration,
      breadClubRefundFenceMigration,
      breadClubProviderSyncMigration,
      adminOrderScopeMigration,
      schemaHealthV2Migration,
      publicTableWriteGrantMigration,
      schemaHealthMigration,
    ];
    let previousOffset = -1;
    for (const migration of terminalMigrations) {
      const offset = schema.indexOf(migration.trim());
      expect(offset).toBeGreaterThan(previousOffset);
      previousOffset = offset;
    }
  });

  it("makes the deep health probe verify the complete operational schema", () => {
    for (const sql of [schema, schemaHealthMigration]) {
      expect(sql).toContain(
        "create or replace function public.operational_schema_healthcheck",
      );
      expect(sql).toContain("Required operational migrations are missing.");
      expect(sql).toContain("return '20260808140000'");
      expect(sql).toContain("from public, anon, authenticated");
      expect(sql).toContain("to service_role");
    }
    expect(schema.trimEnd().endsWith(schemaHealthMigration.trim())).toBe(true);
  });
});
