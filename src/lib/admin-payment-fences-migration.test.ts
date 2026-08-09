import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ORDER_ID = "50000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "50000000-0000-4000-8000-000000000002";
const CURRENT_MENU_ID = "50000000-0000-4000-8000-000000000003";
const CURRENT_WINDOW_ID = "50000000-0000-4000-8000-000000000004";
const NEXT_MENU_ID = "50000000-0000-4000-8000-000000000005";
const NEXT_WINDOW_ID = "50000000-0000-4000-8000-000000000006";

const paymentFenceMigration = readFileSync(
  "supabase/migrations/20260808120000_admin_payment_fences.sql",
  "utf8",
).trim();
const scopeFenceMigration = readFileSync(
  "supabase/migrations/20260808132000_admin_order_scope_fences.sql",
  "utf8",
).trim();
const canonicalSchema = readFileSync("supabase/schema.sql", "utf8").replace(
  'create extension if not exists "pgcrypto";',
  "",
);
const paymentFenceOffset = canonicalSchema.indexOf(paymentFenceMigration);
const prerequisiteSchema =
  paymentFenceOffset === -1
    ? canonicalSchema
    : canonicalSchema.slice(0, paymentFenceOffset);

describe("admin payment-fence migration", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create table auth.users (id uuid primary key);
      create schema storage;
      create table storage.buckets (
        id text primary key,
        name text not null,
        public boolean not null,
        file_size_limit bigint,
        allowed_mime_types text[]
      );
      create table storage.objects (
        id uuid primary key default gen_random_uuid(),
        bucket_id text
      );
      alter table storage.objects enable row level security;
      create schema extensions;
      create function extensions.gen_random_bytes(integer)
      returns bytea
      language sql
      as $$
        select decode(
          repeat(chr(48) || chr(48), $1),
          chr(104) || chr(101) || chr(120)
        )
      $$;
    `);
    await database.exec(prerequisiteSchema);
    await database.exec(paymentFenceMigration);
    await database.exec(scopeFenceMigration);

    await database.query(
      `insert into public.products (
        id, slug, name, category, description, price_cents, active
      ) values ($1, $2, $3, 'bread', $4, 1400, true)`,
      [
        PRODUCT_ID,
        "refund-fence-test-loaf",
        "Refund Fence Test Loaf",
        "Only used by the payment-fence PostgreSQL integration test.",
      ],
    );
    await database.query(
      `insert into public.weekly_menus (
        id, name, order_cutoff_at, starts_at, ends_at, published
      ) values
        ($1, $2, $3, $4, $5, true),
        ($6, $7, $8, $9, $10, true)`,
      [
        CURRENT_MENU_ID,
        "Refund fence current week",
        "2099-08-13T23:59:00Z",
        "2099-08-10T00:00:00Z",
        "2099-08-17T00:00:00Z",
        NEXT_MENU_ID,
        "Refund fence next week",
        "2099-08-20T23:59:00Z",
        "2099-08-17T00:00:00Z",
        "2099-08-24T00:00:00Z",
      ],
    );
    await database.query(
      `insert into public.weekly_menu_items (
        weekly_menu_id, product_id, available_quantity, sold_quantity
      ) values ($1, $3, 5, 0), ($2, $3, 5, 0)`,
      [CURRENT_MENU_ID, NEXT_MENU_ID, PRODUCT_ID],
    );
    await database.query(
      `insert into public.delivery_windows (
        id, weekly_menu_id, label, starts_at, ends_at, capacity, reserved
      ) values
        ($1, $2, 'Sunday 3-6 PM', $3, $4, 5, 0),
        ($5, $6, 'Sunday 3-6 PM', $7, $8, 5, 0)`,
      [
        CURRENT_WINDOW_ID,
        CURRENT_MENU_ID,
        "2099-08-16T19:00:00Z",
        "2099-08-16T22:00:00Z",
        NEXT_WINDOW_ID,
        NEXT_MENU_ID,
        "2099-08-23T19:00:00Z",
        "2099-08-23T22:00:00Z",
      ],
    );
    const customer = await database.query<{ id: string }>(
      `insert into public.customers (name, email, phone)
       values ($1, $2, $3)
       returning id`,
      ["Refund Fence Customer", "refund-fence@example.com", "4045550100"],
    );
    await database.query(
      `insert into public.orders (
        id,
        customer_id,
        delivery_window_id,
        status,
        source,
        stripe_checkout_session_id,
        subtotal_cents,
        total_cents,
        delivery_address,
        next_week_ok,
        approval_mode,
        paid_at
      ) values (
        $1, $2, $3, 'pending_approval', 'storefront', $4, 1400, 1400,
        $5::jsonb, true, 'after_cutoff', now()
      )`,
      [
        ORDER_ID,
        customer.rows[0].id,
        CURRENT_WINDOW_ID,
        "cs_refund_fence_test",
        JSON.stringify({
          line1: "123 Main Street",
          city: "Canton",
          state: "GA",
          postalCode: "30114",
        }),
      ],
    );
    await database.query(
      `insert into public.order_items (
        order_id, product_id, quantity, unit_price_cents
      ) values ($1, $2, 1, 1400)`,
      [ORDER_ID, PRODUCT_ID],
    );
  }, 30_000);

  afterAll(async () => {
    await database.close();
  });

  it("fences acceptance and movement until the claimed refund is finalized", async () => {
    const claimed = await database.query<{
      checkout_session_id: string;
      refund_id: string | null;
    }>(
      `select * from public.admin_begin_approval_refund($1, $2)`,
      [ORDER_ID, "owner@example.com"],
    );

    expect(claimed.rows).toEqual([
      {
        checkout_session_id: "cs_refund_fence_test",
        refund_id: null,
      },
    ]);

    await expect(
      database.query(
        `select public.admin_accept_approval_order($1, null, $2)`,
        [ORDER_ID, "other-admin@example.com"],
      ),
    ).rejects.toThrow(/refund in progress/i);
    await expect(
      database.query(
        `select public.admin_accept_approval_order($1, $2, $3)`,
        [ORDER_ID, NEXT_WINDOW_ID, "other-admin@example.com"],
      ),
    ).rejects.toThrow(/refund in progress/i);

    const inventoryAfterRaces = await database.query<{
      current_reserved: number;
      current_sold: number;
      next_reserved: number;
      next_sold: number;
    }>(
      `select
        (select reserved::integer from public.delivery_windows where id = $1)
          as current_reserved,
        (select sold_quantity::integer from public.weekly_menu_items
          where weekly_menu_id = $2 and product_id = $3) as current_sold,
        (select reserved::integer from public.delivery_windows where id = $4)
          as next_reserved,
        (select sold_quantity::integer from public.weekly_menu_items
          where weekly_menu_id = $5 and product_id = $3) as next_sold`,
      [
        CURRENT_WINDOW_ID,
        CURRENT_MENU_ID,
        PRODUCT_ID,
        NEXT_WINDOW_ID,
        NEXT_MENU_ID,
      ],
    );
    expect(inventoryAfterRaces.rows[0]).toEqual({
      current_reserved: 0,
      current_sold: 0,
      next_reserved: 0,
      next_sold: 0,
    });

    const recorded = await database.query<{ recorded: boolean }>(
      `select public.admin_record_approval_refund(
        $1, $2, $3, $4
      ) as recorded`,
      [ORDER_ID, "re_pending_refund", "pending", "owner@example.com"],
    );
    expect(recorded.rows[0].recorded).toBe(true);

    const pendingState = await database.query<{
      status: string;
      delivery_window_id: string;
      approval_refund_started_at: Date | string | null;
      stripe_refund_id: string | null;
      admin_decision_note: string | null;
      actions: string[];
    }>(
      `select
        order_record.status::text,
        order_record.delivery_window_id,
        order_record.approval_refund_started_at,
        order_record.stripe_refund_id,
        order_record.admin_decision_note,
        array(
          select event.action
          from public.admin_order_events event
          where event.order_id = order_record.id
          order by event.created_at, event.action
        ) as actions
       from public.orders order_record
       where order_record.id = $1`,
      [ORDER_ID],
    );
    expect(pendingState.rows[0]).toMatchObject({
      status: "pending_approval",
      delivery_window_id: CURRENT_WINDOW_ID,
      stripe_refund_id: "re_pending_refund",
      admin_decision_note: "Stripe refund pending; confirmation pending.",
      actions: ["begin_approval_refund", "record_approval_refund"],
    });
    expect(pendingState.rows[0].approval_refund_started_at).not.toBeNull();

    const finalized = await database.query<{ finalized: boolean }>(
      `select public.admin_finalize_approval_refund($1, $2, $3) as finalized`,
      [ORDER_ID, "re_succeeded_refund", "owner@example.com"],
    );
    expect(finalized.rows[0].finalized).toBe(true);

    const finalState = await database.query<{
      status: string;
      denied_at: Date | string | null;
      refunded_at: Date | string | null;
      stripe_refund_id: string | null;
      admin_decision_note: string | null;
      final_event_count: number;
    }>(
      `select
        order_record.status::text,
        order_record.denied_at,
        order_record.refunded_at,
        order_record.stripe_refund_id,
        order_record.admin_decision_note,
        (
          select count(*)::integer
          from public.admin_order_events event
          where event.order_id = order_record.id
            and event.action = 'deny_approval_refund'
            and event.previous_status = 'pending_approval'
            and event.next_status = 'canceled'
            and event.details ->> 'stripe_refund_id' = 're_succeeded_refund'
        ) as final_event_count
       from public.orders order_record
       where order_record.id = $1`,
      [ORDER_ID],
    );
    expect(finalState.rows[0]).toMatchObject({
      status: "canceled",
      stripe_refund_id: "re_succeeded_refund",
      admin_decision_note: "Denied approval request and refunded payment.",
      final_event_count: 1,
    });
    expect(finalState.rows[0].denied_at).not.toBeNull();
    expect(finalState.rows[0].refunded_at).not.toBeNull();

    const replay = await database.query<{ finalized: boolean }>(
      `select public.admin_finalize_approval_refund($1, $2, $3) as finalized`,
      [ORDER_ID, "re_succeeded_refund", "owner@example.com"],
    );
    expect(replay.rows[0].finalized).toBe(false);
  });

  it("rejects a command when its locked order is outside the selected delivery week", async () => {
    await expect(
      database.query(
        `select public.admin_accept_approval_order_scoped($1, $2, null, $3)`,
        [ORDER_ID, NEXT_MENU_ID, "owner@example.com"],
      ),
    ).rejects.toThrow(/does not belong to the selected delivery week/i);
  });

  it("denies every refund command to anon and authenticated roles", async () => {
    const signatures = [
      "public.admin_begin_approval_refund(uuid,text)",
      "public.admin_record_approval_refund(uuid,text,text,text)",
      "public.admin_finalize_approval_refund(uuid,text,text)",
    ];

    for (const role of ["anon", "authenticated"]) {
      for (const signature of signatures) {
        const privilege = await database.query<{ allowed: boolean }>(
          "select has_function_privilege($1, $2, 'EXECUTE') as allowed",
          [role, signature],
        );
        expect(privilege.rows[0].allowed).toBe(false);
      }

      await database.exec(`set role ${role}`);
      try {
        await expect(
          database.query(
            `select * from public.admin_begin_approval_refund($1, $2)`,
            [ORDER_ID, "blocked@example.com"],
          ),
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await database.exec("reset role");
      }
    }

    for (const signature of signatures) {
      const privilege = await database.query<{ allowed: boolean }>(
        "select has_function_privilege('service_role', $1, 'EXECUTE') as allowed",
        [signature],
      );
      expect(privilege.rows[0].allowed).toBe(true);
    }
  });
});
