import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const canonicalSchema = readFileSync("supabase/schema.sql", "utf8").replace(
  'create extension if not exists "pgcrypto";',
  "",
);

describe("canonical PostgreSQL schema", () => {
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
  }, 20_000);

  afterAll(async () => {
    await database.close();
  });

  it("executes the fresh-install schema in PostgreSQL", async () => {
    const tables = await database.query<{ count: number }>(
      `select count(*)::integer as count
       from pg_tables
       where schemaname = $1`,
      ["public"],
    );
    const functions = await database.query<{ count: number }>(
      `select count(*)::integer as count
       from pg_proc
       join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
       where pg_namespace.nspname = $1`,
      ["public"],
    );

    expect(tables.rows[0].count).toBeGreaterThanOrEqual(30);
    expect(functions.rows[0].count).toBeGreaterThanOrEqual(31);
  });

  it("reports the terminal operational schema version", async () => {
    const result = await database.query<{ version: string }>(
      "select public.operational_schema_healthcheck() as version",
    );

    expect(result.rows[0]?.version).toBe("20260808140000");
  });

  it("keeps sensitive configuration commands server-only", async () => {
    const privilege = async (role: string, signature: string) => {
      const result = await database.query<{ allowed: boolean }>(
        "select has_function_privilege($1, $2, $3) as allowed",
        [role, signature, "EXECUTE"],
      );
      return result.rows[0].allowed;
    };
    const signature =
      "public.admin_save_delivery_configuration(uuid,jsonb,jsonb,text)";

    await expect(privilege("anon", signature)).resolves.toBe(false);
    await expect(privilege("authenticated", signature)).resolves.toBe(false);
    await expect(privilege("service_role", signature)).resolves.toBe(true);
  });

  it("does not expose any security-definer function to public API roles", async () => {
    const exposed = await database.query<{ signature: string }>(
      `select procedure.oid::regprocedure::text as signature
       from pg_proc procedure
       join pg_namespace namespace on namespace.oid = procedure.pronamespace
       where namespace.nspname = 'public'
         and procedure.prosecdef
         and (
           has_function_privilege('anon', procedure.oid, 'EXECUTE')
           or has_function_privilege(
             'authenticated', procedure.oid, 'EXECUTE'
           )
         )
       order by signature`,
    );

    expect(exposed.rows).toEqual([]);
  });

  it("keeps every public table behind RLS and denies direct client writes", async () => {
    const unsafeTables = await database.query<{
      table_name: string;
      reason: string;
    }>(
      `select table_record.relname as table_name,
        case
          when not table_record.relrowsecurity then 'rls_disabled'
          else 'client_write_grant'
        end as reason
       from pg_class table_record
       join pg_namespace namespace on namespace.oid = table_record.relnamespace
       where namespace.nspname = 'public'
         and table_record.relkind = 'r'
         and (
           not table_record.relrowsecurity
           or has_table_privilege(
             'anon', table_record.oid, 'INSERT,UPDATE,DELETE'
           )
           or has_table_privilege(
             'authenticated', table_record.oid, 'INSERT,UPDATE,DELETE'
           )
         )
       order by table_name`,
    );

    expect(unsafeTables.rows).toEqual([]);
  });

  it("atomically saves a product and attaches it to an upcoming menu", async () => {
    const menu = await database.query<{ id: string }>(
      `insert into public.weekly_menus (
        name, order_cutoff_at, starts_at, ends_at, published
      ) values ($1, $2, $3, $4, true)
      returning id`,
      [
        "Future product test week",
        "2099-08-13T23:59:00Z",
        "2099-08-10T00:00:00Z",
        "2099-08-17T00:00:00Z",
      ],
    );
    const saved = await database.query<{ id: string }>(
      `select public.admin_save_product(
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16, $17
      ) as id`,
      [
        null,
        "Migration Test Loaf",
        "migration-test-loaf",
        "bread",
        "A product created by the PostgreSQL integration test.",
        ["Flour", "Water", "Salt"],
        ["Wheat"],
        1400,
        400,
        null,
        "from-stone-100 via-amber-100 to-orange-200",
        true,
        true,
        [menu.rows[0].id],
        12,
        true,
        "owner@example.com",
      ],
    );
    const state = await database.query<{
      product_count: number;
      menu_item_count: number;
      event_count: number;
    }>(
      `select
        (select count(*)::integer from public.products where id = $1)
          as product_count,
        (select count(*)::integer from public.weekly_menu_items
          where weekly_menu_id = $2 and product_id = $1) as menu_item_count,
        (select count(*)::integer from public.admin_configuration_events
          where action = $3 and details ->> $4 = $1::text) as event_count`,
      [saved.rows[0].id, menu.rows[0].id, "save_product", "product_id"],
    );

    expect(state.rows[0]).toEqual({
      product_count: 1,
      menu_item_count: 1,
      event_count: 1,
    });
  });

  it("creates storefront checkout attempts exactly once and rolls back failed reservations", async () => {
    const productId = "00000000-0000-4000-8000-000000000099";
    const menu = await database.query<{ id: string }>(
      `insert into public.weekly_menus (
        name, order_cutoff_at, starts_at, ends_at, published
      ) values ($1, $2, $3, $4, true)
      returning id`,
      [
        "Atomic checkout test week",
        "2099-08-13T23:59:00Z",
        "2099-08-10T00:00:00Z",
        "2099-08-17T00:00:00Z",
      ],
    );
    await database.query(
      `insert into public.products (
        id, slug, name, category, description, price_cents, active
      ) values ($1, $2, $3, 'bread', $4, $5, true)`,
      [
        productId,
        "atomic-checkout-test-loaf",
        "Atomic Checkout Test Loaf",
        "Only used by the PostgreSQL integration test.",
        1400,
      ],
    );
    await database.query(
      `insert into public.weekly_menu_items (
        weekly_menu_id, product_id, available_quantity, sold_quantity
      ) values ($1, $2, 5, 0)`,
      [menu.rows[0].id, productId],
    );
    const deliveryWindow = await database.query<{ id: string }>(
      `insert into public.delivery_windows (
        weekly_menu_id, label, starts_at, ends_at, capacity, reserved
      ) values ($1, $2, $3, $4, 2, 0)
      returning id`,
      [
        menu.rows[0].id,
        "Sunday 3-6 PM",
        "2099-08-16T19:00:00Z",
        "2099-08-16T22:00:00Z",
      ],
    );

    const checkoutArguments = [
      "33333333-3333-4333-8333-333333333333",
      "a".repeat(64),
      "Atomic Customer",
      "atomic@example.com",
      "4045550100",
      deliveryWindow.rows[0].id,
      "standard",
      JSON.stringify({
        name: "Atomic Customer",
        email: "atomic@example.com",
        phone: "4045550100",
        line1: "123 Main Street",
        line2: "",
        city: "Canton",
        state: "GA",
        postalCode: "30114",
      }),
      5,
      "Front porch",
      JSON.stringify({ eligible: true, feeCents: 600 }),
      600,
      "Handle with care",
      false,
      "b".repeat(48),
      JSON.stringify([
        { product_id: productId, quantity: 2, unit_price_cents: 1400 },
      ]),
      true,
    ];
    const createSql = `select * from public.create_storefront_checkout_order(
      $1, $2, $3, $4, $5, $6, $7, $8, $9,
      $10, $11, $12, $13, $14, $15, $16, $17
    )`;
    const first = await database.query<{
      order_id: string;
      checkout_cancel_token: string;
      total_cents: number;
    }>(createSql, checkoutArguments);
    const replay = await database.query<{
      order_id: string;
      checkout_cancel_token: string;
      total_cents: number;
    }>(createSql, [
      ...checkoutArguments.slice(0, 14),
      "c".repeat(48),
      ...checkoutArguments.slice(15),
    ]);

    expect(replay.rows[0]).toEqual(first.rows[0]);
    expect(first.rows[0]).toMatchObject({
      checkout_cancel_token: "b".repeat(48),
      total_cents: 3400,
    });

    const overCapacityArguments = [
      "44444444-4444-4444-8444-444444444444",
      "d".repeat(64),
      ...checkoutArguments.slice(2, 15),
      JSON.stringify([
        { product_id: productId, quantity: 4, unit_price_cents: 1400 },
      ]),
      true,
    ];
    await expect(
      database.query(createSql, overCapacityArguments),
    ).rejects.toThrow(/enough inventory/i);

    const state = await database.query<{
      order_count: number;
      failed_attempt_count: number;
      sold_quantity: number;
      reserved: number;
    }>(
      `select
        (select count(*)::integer from public.orders
          where checkout_attempt_id = $1) as order_count,
        (select count(*)::integer from public.orders
          where checkout_attempt_id = $2) as failed_attempt_count,
        (select sold_quantity from public.weekly_menu_items
          where weekly_menu_id = $3 and product_id = $4) as sold_quantity,
        (select reserved from public.delivery_windows where id = $5) as reserved`,
      [
        checkoutArguments[0],
        overCapacityArguments[0],
        menu.rows[0].id,
        productId,
        deliveryWindow.rows[0].id,
      ],
    );
    expect(state.rows[0]).toEqual({
      order_count: 1,
      failed_attempt_count: 0,
      sold_quantity: 2,
      reserved: 1,
    });

    const attached = await database.query<{ attached: boolean }>(
      "select public.attach_storefront_checkout_session($1, $2) as attached",
      [first.rows[0].order_id, "cs_atomic_checkout_one"],
    );
    expect(attached.rows[0].attached).toBe(true);
    await expect(
      database.query(
        "select public.attach_storefront_checkout_session($1, $2)",
        [first.rows[0].order_id, "cs_atomic_checkout_two"],
      ),
    ).rejects.toThrow(/different Stripe Checkout Session/i);
  });

  it("keeps atomic storefront checkout commands server-only", async () => {
    const privilege = async (role: string, signature: string) => {
      const result = await database.query<{ allowed: boolean }>(
        "select has_function_privilege($1, $2, $3) as allowed",
        [role, signature, "EXECUTE"],
      );
      return result.rows[0].allowed;
    };
    const createSignature =
      "public.create_storefront_checkout_order(uuid,text,text,text,text,uuid,text,jsonb,numeric,text,jsonb,integer,text,boolean,text,jsonb,boolean)";

    await expect(privilege("anon", createSignature)).resolves.toBe(false);
    await expect(privilege("authenticated", createSignature)).resolves.toBe(
      false,
    );
    await expect(privilege("service_role", createSignature)).resolves.toBe(
      true,
    );
    await expect(
      privilege(
        "anon",
        "public.attach_storefront_checkout_session(uuid,text)",
      ),
    ).resolves.toBe(false);
    await expect(
      privilege(
        "service_role",
        "public.cleanup_abandoned_storefront_checkouts()",
      ),
    ).resolves.toBe(true);
  });
});
