import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MEMBER_ID = "71000000-0000-4000-8000-000000000001";
const CREDIT_CYCLE_ID = "71000000-0000-4000-8000-000000000002";
const REFUND_CYCLE_ID = "71000000-0000-4000-8000-000000000003";
const CREDIT_ID = "71000000-0000-4000-8000-000000000004";
const PRODUCT_ID = "71000000-0000-4000-8000-000000000005";
const SOURCE_MENU_ID = "71000000-0000-4000-8000-000000000006";
const TARGET_MENU_ID = "71000000-0000-4000-8000-000000000007";
const REFUND_MENU_ID = "71000000-0000-4000-8000-000000000008";
const SOURCE_WINDOW_ID = "71000000-0000-4000-8000-000000000009";
const TARGET_WINDOW_ID = "71000000-0000-4000-8000-000000000010";
const REFUND_WINDOW_ID = "71000000-0000-4000-8000-000000000011";
const SOURCE_ORDER_ID = "71000000-0000-4000-8000-000000000012";
const TARGET_ORDER_ID = "71000000-0000-4000-8000-000000000013";
const REFUND_ORDER_ID = "71000000-0000-4000-8000-000000000014";
const SOURCE_FULFILLMENT_ID = "71000000-0000-4000-8000-000000000015";
const TARGET_FULFILLMENT_ID = "71000000-0000-4000-8000-000000000016";
const REFUND_FULFILLMENT_ID = "71000000-0000-4000-8000-000000000017";
const EXPIRED_CREDIT_ID = "71000000-0000-4000-8000-000000000018";
const ADDON_ID = "71000000-0000-4000-8000-000000000019";
const RACING_ADDON_ID = "71000000-0000-4000-8000-000000000020";
const PAST_DUE_CYCLE_ID = "71000000-0000-4000-8000-000000000021";

const canonicalSchema = readFileSync("supabase/schema.sql", "utf8").replace(
  'create extension if not exists "pgcrypto";',
  "",
);
const refundFenceMigration = readFileSync(
  "supabase/migrations/20260808130000_bread_club_refund_fences.sql",
  "utf8",
);

describe("Bread Club refund-fence migration", () => {
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
    await database.exec(canonicalSchema);
    await database.exec(refundFenceMigration);

    await database.query(
      `insert into public.products (
        id, slug, name, category, description, price_cents, active
      ) values ($1, $2, $3, 'bread', $4, 1100, true)`,
      [
        PRODUCT_ID,
        "bread-club-refund-fence-loaf",
        "Refund Fence Loaf",
        "Only used by the Bread Club refund-fence integration test.",
      ],
    );
    await database.query(
      `insert into public.bread_club_plan_products (
        plan_id, product_id, active, guaranteed
      ) values ($1, $2, true, true)
      on conflict (plan_id, product_id) do update set active = true`,
      ["10000000-0000-4000-8000-000000000001", PRODUCT_ID],
    );
    await database.query(
      `insert into public.weekly_menus (
        id, name, order_cutoff_at, starts_at, ends_at, published
      ) values
        ($1, 'Credit source', '2099-08-01T00:00:00Z', '2099-08-02T00:00:00Z', '2099-08-09T00:00:00Z', true),
        ($2, 'Credit target', '2099-08-08T00:00:00Z', '2099-08-09T00:00:00Z', '2099-08-16T00:00:00Z', true),
        ($3, 'Cycle refund', '2099-08-15T00:00:00Z', '2099-08-16T00:00:00Z', '2099-08-23T00:00:00Z', true)`,
      [SOURCE_MENU_ID, TARGET_MENU_ID, REFUND_MENU_ID],
    );
    await database.query(
      `insert into public.weekly_menu_items (
        weekly_menu_id, product_id, available_quantity, sold_quantity
      ) values ($1, $4, 10, 0), ($2, $4, 10, 1), ($3, $4, 10, 1)`,
      [SOURCE_MENU_ID, TARGET_MENU_ID, REFUND_MENU_ID, PRODUCT_ID],
    );
    await database.query(
      `insert into public.delivery_windows (
        id, weekly_menu_id, label, starts_at, ends_at, capacity, reserved
      ) values
        ($1, $2, 'Source Sunday', '2099-08-08T19:00:00Z', '2099-08-08T22:00:00Z', 10, 0),
        ($3, $4, 'Target Sunday', '2099-08-15T19:00:00Z', '2099-08-15T22:00:00Z', 10, 1),
        ($5, $6, 'Refund Sunday', '2099-08-22T19:00:00Z', '2099-08-22T22:00:00Z', 10, 1)`,
      [
        SOURCE_WINDOW_ID,
        SOURCE_MENU_ID,
        TARGET_WINDOW_ID,
        TARGET_MENU_ID,
        REFUND_WINDOW_ID,
        REFUND_MENU_ID,
      ],
    );
    const customer = await database.query<{ id: string }>(
      `insert into public.customers (name, email, phone)
       values ('Refund Fence Member', 'refund-member@example.com', '4045550199')
       returning id`,
    );
    await database.query(
      `insert into public.bread_club_memberships (
        id,
        customer_id,
        plan_id,
        status,
        default_selection,
        delivery_address,
        delivery_check,
        route_fee_cents,
        route_band_key,
        first_delivery_at,
        consent_version,
        consent_text,
        consented_at
      ) values (
        $1, $2, $3, 'active', $4::jsonb, $5::jsonb, $6::jsonb,
        800, '0-10', '2099-08-08T19:00:00Z', 'test-v1', 'Test consent', now()
      )`,
      [
        MEMBER_ID,
        customer.rows[0].id,
        "10000000-0000-4000-8000-000000000001",
        JSON.stringify([{ product_id: PRODUCT_ID, quantity: 1 }]),
        JSON.stringify({
          line1: "123 Main Street",
          city: "Canton",
          state: "GA",
          postalCode: "30114",
        }),
        JSON.stringify({ eligible: true }),
      ],
    );
    await database.query(
      `insert into public.bread_club_cycles (
        id, membership_id, cycle_number, status, period_start, period_end,
        plan_price_cents, delivery_price_cents, total_cents,
        stripe_invoice_id, paid_at
      ) values
        ($1, $3, 1, 'paid', '2099-08-01T00:00:00Z', '2099-08-29T00:00:00Z', 4400, 800, 5200, 'in_credit_fence', now()),
        ($2, $3, 2, 'paid', '2099-08-29T00:00:00Z', '2099-09-26T00:00:00Z', 4400, 800, 5200, 'in_cycle_fence', now())`,
      [CREDIT_CYCLE_ID, REFUND_CYCLE_ID, MEMBER_ID],
    );

    const address = JSON.stringify({
      line1: "123 Main Street",
      city: "Canton",
      state: "GA",
      postalCode: "30114",
    });
    await database.query(
      `insert into public.orders (
        id, customer_id, delivery_window_id, status, source,
        bread_club_membership_id, subtotal_cents, total_cents,
        delivery_address, paid_at
      ) values
        ($1, $4, $5, 'canceled', 'bread_club', $7, 1100, 1100, $8::jsonb, now()),
        ($2, $4, $6, 'paid', 'bread_club', $7, 1100, 1100, $8::jsonb, now()),
        ($3, $4, $9, 'paid', 'bread_club', $7, 1100, 1100, $8::jsonb, now())`,
      [
        SOURCE_ORDER_ID,
        TARGET_ORDER_ID,
        REFUND_ORDER_ID,
        customer.rows[0].id,
        SOURCE_WINDOW_ID,
        TARGET_WINDOW_ID,
        MEMBER_ID,
        address,
        REFUND_WINDOW_ID,
      ],
    );
    await database.query(
      `insert into public.order_items (order_id, product_id, quantity, unit_price_cents)
       values ($1, $4, 1, 1100), ($2, $4, 1, 1100), ($3, $4, 1, 1100)`,
      [SOURCE_ORDER_ID, TARGET_ORDER_ID, REFUND_ORDER_ID, PRODUCT_ID],
    );
    await database.query(
      `insert into public.bread_club_fulfillments (
        id, membership_id, cycle_id, weekly_menu_id, delivery_window_id,
        order_id, status, selection, skipped_at
      ) values
        ($1, $4, $5, $6, $7, $8, 'skipped', '[]'::jsonb, now()),
        ($2, $4, $5, $9, $10, $11, 'scheduled', $12::jsonb, null),
        ($3, $4, $13, $14, $15, $16, 'scheduled', $12::jsonb, null)`,
      [
        SOURCE_FULFILLMENT_ID,
        TARGET_FULFILLMENT_ID,
        REFUND_FULFILLMENT_ID,
        MEMBER_ID,
        CREDIT_CYCLE_ID,
        SOURCE_MENU_ID,
        SOURCE_WINDOW_ID,
        SOURCE_ORDER_ID,
        TARGET_MENU_ID,
        TARGET_WINDOW_ID,
        TARGET_ORDER_ID,
        JSON.stringify([{ product_id: PRODUCT_ID, quantity: 1 }]),
        REFUND_CYCLE_ID,
        REFUND_MENU_ID,
        REFUND_WINDOW_ID,
        REFUND_ORDER_ID,
      ],
    );
    await database.query(
      `update public.orders
       set bread_club_fulfillment_id = case id
         when $1 then $4::uuid
         when $2 then $5::uuid
         when $3 then $6::uuid
       end
       where id in ($1, $2, $3)`,
      [
        SOURCE_ORDER_ID,
        TARGET_ORDER_ID,
        REFUND_ORDER_ID,
        SOURCE_FULFILLMENT_ID,
        TARGET_FULFILLMENT_ID,
        REFUND_FULFILLMENT_ID,
      ],
    );
    await database.query(
      `insert into public.bread_club_rollover_credits (
        id, membership_id, source_fulfillment_id, quantity,
        delivery_fee_credit_cents, status, expires_at,
        stripe_invoice_item_id
      ) values ($1, $2, $3, 1, 200, 'available', '2099-12-31T00:00:00Z', 'ii_credit_fence')`,
      [CREDIT_ID, MEMBER_ID, SOURCE_FULFILLMENT_ID],
    );
  }, 30_000);

  afterAll(async () => {
    await database.close();
  });

  it("keeps all new security-definer refund commands service-role only", async () => {
    const exposed = await database.query<{ signature: string }>(`
      select procedure.oid::regprocedure::text as signature
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname in (
          'begin_bread_club_credit_refund_attempt',
          'record_bread_club_credit_refund',
          'record_bread_club_credit_refund_error',
          'begin_bread_club_cycle_refund_attempt',
          'record_bread_club_cycle_refund',
          'record_bread_club_cycle_refund_error'
        )
        and (
          has_function_privilege('anon', procedure.oid, 'EXECUTE')
          or has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
        )
    `);

    expect(exposed.rows).toEqual([]);
  });

  it("reuses an unknown credit attempt, advances only after confirmed failure, and fences redemption", async () => {
    const first = await database.query<{
      refund_state: string;
      attempt_key: string;
      amount_cents: number;
    }>(
      `select * from public.begin_bread_club_credit_refund_attempt($1)`,
      [CREDIT_ID],
    );
    expect(first.rows[0]).toMatchObject({
      refund_state: "refund_pending",
      attempt_key: `bread-club-credit-refund:${CREDIT_ID}:1`,
      amount_cents: 1300,
    });

    const unrecordedReplay = await database.query<{
      attempt_key: string;
      provider_status: string | null;
    }>(
      `select attempt_key, provider_status
       from public.begin_bread_club_credit_refund_attempt($1)`,
      [CREDIT_ID],
    );
    expect(unrecordedReplay.rows[0]).toEqual({
      attempt_key: first.rows[0].attempt_key,
      provider_status: null,
    });

    await expect(
      database.query(
        `select public.redeem_bread_club_credit($1, $2, $3)`,
        [CREDIT_ID, TARGET_FULFILLMENT_ID, PRODUCT_ID],
      ),
    ).rejects.toThrow(/no longer available/i);
    await expect(
      database.query(
        `update public.bread_club_rollover_credits
         set status = 'refunded'
         where id = $1`,
        [CREDIT_ID],
      ),
    ).rejects.toThrow(/only be marked refunded after Stripe reports success/i);

    await database.query(
      `select public.record_bread_club_credit_refund_error($1, $2, $3)`,
      [CREDIT_ID, first.rows[0].attempt_key, "provider timeout"],
    );
    const replay = await database.query<{
      attempt_key: string;
      provider_status: string;
    }>(
      `select attempt_key, provider_status
       from public.begin_bread_club_credit_refund_attempt($1)`,
      [CREDIT_ID],
    );
    expect(replay.rows[0]).toEqual({
      attempt_key: first.rows[0].attempt_key,
      provider_status: "unknown",
    });

    const failed = await database.query<{ state: string }>(
      `select public.record_bread_club_credit_refund(
        $1, $2, 're_credit_failed', 'failed', 'bank rejected refund'
      ) as state`,
      [CREDIT_ID, first.rows[0].attempt_key],
    );
    expect(failed.rows[0].state).toBe("refund_pending");

    const retry = await database.query<{
      attempt_key: string;
      refund_id: string | null;
      provider_status: string | null;
    }>(
      `select attempt_key, refund_id, provider_status
       from public.begin_bread_club_credit_refund_attempt($1)`,
      [CREDIT_ID],
    );
    expect(retry.rows[0]).toEqual({
      attempt_key: `bread-club-credit-refund:${CREDIT_ID}:2`,
      refund_id: null,
      provider_status: null,
    });

    const succeeded = await database.query<{ state: string }>(
      `select public.record_bread_club_credit_refund(
        $1, $2, 're_credit_succeeded', 'succeeded', null
      ) as state`,
      [CREDIT_ID, retry.rows[0].attempt_key],
    );
    expect(succeeded.rows[0].state).toBe("refunded");
    const final = await database.query<{
      status: string;
      stripe_refund_id: string;
      stripe_refund_status: string;
      refund_attempt_count: number;
      refunded: boolean;
    }>(
      `select status, stripe_refund_id, stripe_refund_status,
        refund_attempt_count::integer,
        refunded_at is not null as refunded
       from public.bread_club_rollover_credits
       where id = $1`,
      [CREDIT_ID],
    );
    expect(final.rows[0]).toEqual({
      status: "refunded",
      stripe_refund_id: "re_credit_succeeded",
      stripe_refund_status: "succeeded",
      refund_attempt_count: 2,
      refunded: true,
    });
  });

  it("preserves refund eligibility when cancellation preceded credit expiration", async () => {
    await database.query(
      `update public.bread_club_memberships
       set status = 'canceled',
           canceled_at = now() - interval '2 days'
       where id = $1`,
      [MEMBER_ID],
    );
    await database.query(
      `insert into public.bread_club_rollover_credits (
        id, membership_id, source_fulfillment_id, quantity,
        delivery_fee_credit_cents, status, expires_at
      ) values (
        $1, $2, $3, 1, 200, 'expired', now() - interval '1 day'
      )`,
      [EXPIRED_CREDIT_ID, MEMBER_ID, TARGET_FULFILLMENT_ID],
    );

    const claim = await database.query<{
      refund_state: string;
      attempt_key: string;
      amount_cents: number;
    }>(
      `select * from public.begin_bread_club_credit_refund_attempt($1)`,
      [EXPIRED_CREDIT_ID],
    );

    expect(claim.rows[0]).toMatchObject({
      refund_state: "refund_pending",
      attempt_key: `bread-club-credit-refund:${EXPIRED_CREDIT_ID}:1`,
      amount_cents: 1300,
    });
  });

  it("fences cycle production and releases reservations only after a succeeded refund", async () => {
    const addonItems = JSON.stringify([
      {
        product_id: PRODUCT_ID,
        quantity: 1,
        unit_price_cents: 1100,
        stripe_price_id: "price_refund_fence_addon",
        name: "Refund fence add-on",
      },
    ]);
    await database.query(
      `insert into public.bread_club_addon_checkouts (
        id, membership_id, fulfillment_id, items, subtotal_cents,
        total_cents, status, checkout_cancel_token
      ) values ($1, $2, $3, $4::jsonb, 1100, 1100, 'pending_payment', $5)`,
      [ADDON_ID, MEMBER_ID, REFUND_FULFILLMENT_ID, addonItems, "1".repeat(48)],
    );
    await expect(
      database.query(
        `select * from public.begin_bread_club_cycle_refund_attempt($1)`,
        [REFUND_CYCLE_ID],
      ),
    ).rejects.toThrow(/open or paid add-on/i);

    await database.query(
      `update public.bread_club_addon_checkouts
       set status = 'paid', stripe_payment_intent_id = 'pi_refund_fence'
       where id = $1`,
      [ADDON_ID],
    );
    await expect(
      database.query(
        `select * from public.begin_bread_club_cycle_refund_attempt($1)`,
        [REFUND_CYCLE_ID],
      ),
    ).rejects.toThrow(/open or paid add-on/i);
    await database.query(
      `update public.bread_club_addon_checkouts
       set status = 'canceled'
       where id = $1`,
      [ADDON_ID],
    );

    const claim = await database.query<{
      refund_state: string;
      attempt_key: string;
    }>(
      `select * from public.begin_bread_club_cycle_refund_attempt($1)`,
      [REFUND_CYCLE_ID],
    );
    expect(claim.rows[0]).toMatchObject({
      refund_state: "refund_pending",
      attempt_key: `bread-club-cycle-refund:${REFUND_CYCLE_ID}:1`,
    });

    const unrecordedReplay = await database.query<{
      attempt_key: string;
      provider_status: string | null;
    }>(
      `select attempt_key, provider_status
       from public.begin_bread_club_cycle_refund_attempt($1)`,
      [REFUND_CYCLE_ID],
    );
    expect(unrecordedReplay.rows[0]).toEqual({
      attempt_key: claim.rows[0].attempt_key,
      provider_status: null,
    });

    await expect(
      database.query(
        `insert into public.bread_club_addon_checkouts (
          id, membership_id, fulfillment_id, items, subtotal_cents,
          total_cents, status, checkout_cancel_token
        ) values ($1, $2, $3, $4::jsonb, 1100, 1100, 'pending_payment', $5)`,
        [
          RACING_ADDON_ID,
          MEMBER_ID,
          REFUND_FULFILLMENT_ID,
          addonItems,
          "2".repeat(48),
        ],
      ),
    ).rejects.toThrow(/full-cycle refund in progress or completed/i);

    await expect(
      database.query(
        `update public.orders set status = 'baking' where id = $1`,
        [REFUND_ORDER_ID],
      ),
    ).rejects.toThrow(/refund in progress/i);
    await expect(
      database.query(
        `update public.bread_club_cycles set status = 'refunded' where id = $1`,
        [REFUND_CYCLE_ID],
      ),
    ).rejects.toThrow(/only be marked refunded after Stripe reports success/i);
    await expect(
      database.query(
        `select public.refund_bread_club_cycle($1, 're_unsafe', 'unsafe')`,
        [REFUND_CYCLE_ID],
      ),
    ).rejects.toThrow(/durable Bread Club refund-attempt command/i);

    const pending = await database.query<{ state: string }>(
      `select public.record_bread_club_cycle_refund(
        $1, $2, 're_cycle_pending', 'requires_action', 'Owner refund', null
      ) as state`,
      [REFUND_CYCLE_ID, claim.rows[0].attempt_key],
    );
    expect(pending.rows[0].state).toBe("refund_pending");
    const beforeSuccess = await database.query<{
      cycle_status: string;
      order_status: string;
      fulfillment_status: string;
      reserved: number;
      sold: number;
    }>(
      `select
        (select status::text from public.bread_club_cycles where id = $1) as cycle_status,
        (select status::text from public.orders where id = $2) as order_status,
        (select status from public.bread_club_fulfillments where id = $3) as fulfillment_status,
        (select reserved::integer from public.delivery_windows where id = $4) as reserved,
        (select sold_quantity::integer from public.weekly_menu_items where weekly_menu_id = $5 and product_id = $6) as sold`,
      [
        REFUND_CYCLE_ID,
        REFUND_ORDER_ID,
        REFUND_FULFILLMENT_ID,
        REFUND_WINDOW_ID,
        REFUND_MENU_ID,
        PRODUCT_ID,
      ],
    );
    expect(beforeSuccess.rows[0]).toEqual({
      cycle_status: "refund_pending",
      order_status: "paid",
      fulfillment_status: "scheduled",
      reserved: 1,
      sold: 1,
    });

    const succeeded = await database.query<{ state: string }>(
      `select public.record_bread_club_cycle_refund(
        $1, $2, 're_cycle_succeeded', 'succeeded', 'Owner refund', null
      ) as state`,
      [REFUND_CYCLE_ID, claim.rows[0].attempt_key],
    );
    expect(succeeded.rows[0].state).toBe("refunded");
    const afterSuccess = await database.query<{
      cycle_status: string;
      refund_status: string;
      order_status: string;
      fulfillment_status: string;
      reserved: number;
      sold: number;
    }>(
      `select
        (select status::text from public.bread_club_cycles where id = $1) as cycle_status,
        (select stripe_refund_status from public.bread_club_cycles where id = $1) as refund_status,
        (select status::text from public.orders where id = $2) as order_status,
        (select status from public.bread_club_fulfillments where id = $3) as fulfillment_status,
        (select reserved::integer from public.delivery_windows where id = $4) as reserved,
        (select sold_quantity::integer from public.weekly_menu_items where weekly_menu_id = $5 and product_id = $6) as sold`,
      [
        REFUND_CYCLE_ID,
        REFUND_ORDER_ID,
        REFUND_FULFILLMENT_ID,
        REFUND_WINDOW_ID,
        REFUND_MENU_ID,
        PRODUCT_ID,
      ],
    );
    expect(afterSuccess.rows[0]).toEqual({
      cycle_status: "refunded",
      refund_status: "succeeded",
      order_status: "canceled",
      fulfillment_status: "canceled",
      reserved: 0,
      sold: 0,
    });
  });

  it("cancels past-due reservations and rejects a late paid-invoice replay", async () => {
    await database.query(
      `insert into public.bread_club_cycles (
        id, membership_id, cycle_number, status, period_start, period_end,
        plan_price_cents, delivery_price_cents, total_cents,
        stripe_invoice_id
      ) values (
        $1, $2, 3, 'past_due', '2100-01-01T00:00:00Z',
        '2100-01-29T00:00:00Z', 4400, 800, 5200, 'in_late_paid'
      )`,
      [PAST_DUE_CYCLE_ID, MEMBER_ID],
    );
    const customer = await database.query<{ customer_id: string }>(
      `select customer_id from public.bread_club_memberships where id = $1`,
      [MEMBER_ID],
    );

    for (let index = 1; index <= 4; index += 1) {
      const suffix = String(index).padStart(12, "0");
      const menuId = `72000000-0000-4000-8000-${suffix}`;
      const windowId = `73000000-0000-4000-8000-${suffix}`;
      const orderId = `74000000-0000-4000-8000-${suffix}`;
      const fulfillmentId = `75000000-0000-4000-8000-${suffix}`;
      await database.query(
        `insert into public.weekly_menus (
          id, name, order_cutoff_at, starts_at, ends_at, published
        ) values ($1, $2, '2099-12-01T00:00:00Z',
          '2100-01-01T00:00:00Z', '2100-02-01T00:00:00Z', true)`,
        [menuId, `Past-due recovery ${index}`],
      );
      await database.query(
        `insert into public.weekly_menu_items (
          weekly_menu_id, product_id, available_quantity, sold_quantity
        ) values ($1, $2, 10, 1)`,
        [menuId, PRODUCT_ID],
      );
      await database.query(
        `insert into public.delivery_windows (
          id, weekly_menu_id, label, starts_at, ends_at, capacity, reserved
        ) values ($1, $2, $3, '2100-01-02T19:00:00Z',
          '2100-01-02T22:00:00Z', 10, 1)`,
        [windowId, menuId, `Past-due Sunday ${index}`],
      );
      await database.query(
        `insert into public.orders (
          id, customer_id, delivery_window_id, status, source,
          bread_club_membership_id, subtotal_cents, total_cents,
          delivery_address
        ) values ($1, $2, $3, 'pending_payment', 'bread_club',
          $4, 1100, 1100, $5::jsonb)`,
        [
          orderId,
          customer.rows[0].customer_id,
          windowId,
          MEMBER_ID,
          JSON.stringify({
            line1: "123 Main Street",
            city: "Canton",
            state: "GA",
            postalCode: "30114",
          }),
        ],
      );
      await database.query(
        `insert into public.bread_club_fulfillments (
          id, membership_id, cycle_id, weekly_menu_id, delivery_window_id,
          order_id, status, selection
        ) values ($1, $2, $3, $4, $5, $6, 'pending_payment', $7::jsonb)`,
        [
          fulfillmentId,
          MEMBER_ID,
          PAST_DUE_CYCLE_ID,
          menuId,
          windowId,
          orderId,
          JSON.stringify([{ product_id: PRODUCT_ID, quantity: 1 }]),
        ],
      );
      await database.query(
        `update public.orders set bread_club_fulfillment_id = $1 where id = $2`,
        [fulfillmentId, orderId],
      );
      await database.query(
        `insert into public.order_items (
          order_id, product_id, quantity, unit_price_cents
        ) values ($1, $2, 1, 1100)`,
        [orderId, PRODUCT_ID],
      );
    }

    await database.query(
      `select public.release_bread_club_cycle($1)`,
      [PAST_DUE_CYCLE_ID],
    );
    const released = await database.query<{
      cycle_status: string;
      canceled_fulfillments: number;
      canceled_orders: number;
      remaining_reservations: number;
      remaining_inventory: number;
    }>(
      `select
        (select status from public.bread_club_cycles where id = $1)
          as cycle_status,
        (select count(*)::integer from public.bread_club_fulfillments
          where cycle_id = $1 and status = 'canceled')
          as canceled_fulfillments,
        (select count(*)::integer from public.orders bakery_order
          join public.bread_club_fulfillments fulfillment
            on fulfillment.order_id = bakery_order.id
          where fulfillment.cycle_id = $1 and bakery_order.status = 'canceled')
          as canceled_orders,
        (select coalesce(sum(delivery_window.reserved), 0)::integer
          from public.delivery_windows delivery_window
          join public.bread_club_fulfillments fulfillment
            on fulfillment.delivery_window_id = delivery_window.id
          where fulfillment.cycle_id = $1) as remaining_reservations,
        (select coalesce(sum(menu_item.sold_quantity), 0)::integer
          from public.weekly_menu_items menu_item
          join public.bread_club_fulfillments fulfillment
            on fulfillment.weekly_menu_id = menu_item.weekly_menu_id
          where fulfillment.cycle_id = $1
            and menu_item.product_id = $2) as remaining_inventory`,
      [PAST_DUE_CYCLE_ID, PRODUCT_ID],
    );
    expect(released.rows[0]).toEqual({
      cycle_status: "canceled",
      canceled_fulfillments: 4,
      canceled_orders: 4,
      remaining_reservations: 0,
      remaining_inventory: 0,
    });

    await database.query(
      `update public.bread_club_cycles set status = 'past_due' where id = $1`,
      [PAST_DUE_CYCLE_ID],
    );
    await expect(
      database.query(
        `select public.activate_bread_club_cycle($1, $2, null, now())`,
        [PAST_DUE_CYCLE_ID, "in_late_paid"],
      ),
    ).rejects.toThrow(/four reserved pending fulfillment orders/i);
    const final = await database.query<{
      cycle_status: string;
      canceled_fulfillments: number;
    }>(
      `select
        (select status from public.bread_club_cycles where id = $1)
          as cycle_status,
        (select count(*)::integer from public.bread_club_fulfillments
          where cycle_id = $1 and status = 'canceled')
          as canceled_fulfillments`,
      [PAST_DUE_CYCLE_ID],
    );
    expect(final.rows[0]).toEqual({
      cycle_status: "past_due",
      canceled_fulfillments: 4,
    });
  });
});
