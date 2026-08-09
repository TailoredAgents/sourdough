import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260808121500_atomic_rolling_week.sql",
  "utf8",
);
const rollingWeekSource = readFileSync("src/lib/rolling-weeks.ts", "utf8");

describe("atomic rolling-week migration", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
      create role anon;
      create role authenticated;
      create role service_role;

      create table public.products (
        id uuid primary key default gen_random_uuid(),
        name text not null
      );
      create table public.weekly_menus (
        id uuid primary key default gen_random_uuid(),
        name text not null,
        order_cutoff_at timestamptz not null,
        starts_at timestamptz not null,
        ends_at timestamptz not null,
        published boolean not null default false,
        auto_generated boolean not null default false,
        generation_key text unique,
        source_weekly_menu_id uuid references public.weekly_menus(id)
          on delete set null
      );
      create table public.weekly_menu_items (
        id uuid primary key default gen_random_uuid(),
        weekly_menu_id uuid not null references public.weekly_menus(id)
          on delete cascade,
        product_id uuid not null references public.products(id),
        available_quantity integer not null check (available_quantity >= 0),
        sold_quantity integer not null default 0 check (sold_quantity >= 0),
        featured boolean not null default false,
        unavailable boolean not null default false,
        unique (weekly_menu_id, product_id)
      );
      create table public.delivery_windows (
        id uuid primary key default gen_random_uuid(),
        weekly_menu_id uuid not null references public.weekly_menus(id)
          on delete cascade,
        label text not null check (label <> 'FAIL'),
        starts_at timestamptz not null,
        ends_at timestamptz not null,
        capacity integer not null check (capacity >= 0),
        reserved integer not null default 0 check (reserved >= 0),
        unique (weekly_menu_id)
      );
    `);
    await database.exec(migration);
  }, 20_000);

  afterAll(async () => {
    await database.close();
  });

  it("creates, retries, and repairs a complete week as one transaction", async () => {
    const templateId = "11111111-1111-4111-8111-111111111111";
    const productId = "22222222-2222-4222-8222-222222222222";
    await database.query(
      `insert into public.products (id, name) values ($1, $2)`,
      [productId, "Template loaf"],
    );
    await database.query(
      `insert into public.weekly_menus (
        id, name, order_cutoff_at, starts_at, ends_at, published
      ) values ($1, $2, $3, $4, $5, true)`,
      [
        templateId,
        "Template week",
        "2099-08-14T04:00:00Z",
        "2099-08-10T04:00:00Z",
        "2099-08-17T03:59:00Z",
      ],
    );
    await database.query(
      `insert into public.weekly_menu_items (
        weekly_menu_id, product_id, available_quantity, sold_quantity,
        featured, unavailable
      ) values ($1, $2, 12, 4, true, false)`,
      [templateId, productId],
    );

    const callSql = `select public.ensure_atomic_rolling_week(
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
    ) as id`;
    const args = [
      templateId,
      null,
      "Generated Sunday week",
      `${templateId}:sunday:2099-08-10`,
      "2099-08-14T04:00:00Z",
      "2099-08-10T04:00:00Z",
      "2099-08-17T03:59:00Z",
      "Sunday, Aug 16, 3:00 PM-6:00 PM",
      "2099-08-16T19:00:00Z",
      "2099-08-16T22:00:00Z",
      20,
    ];
    const first = await database.query<{ id: string }>(callSql, args);
    const replay = await database.query<{ id: string }>(callSql, args);

    expect(replay.rows[0].id).toBe(first.rows[0].id);
    const generated = await database.query<{
      menu_count: number;
      item_count: number;
      sold_quantity: number;
      window_count: number;
    }>(
      `select
        (select count(*)::integer from public.weekly_menus
          where generation_key = $1) as menu_count,
        (select count(*)::integer from public.weekly_menu_items
          where weekly_menu_id = $2) as item_count,
        (select sold_quantity from public.weekly_menu_items
          where weekly_menu_id = $2 and product_id = $3) as sold_quantity,
        (select count(*)::integer from public.delivery_windows
          where weekly_menu_id = $2) as window_count`,
      [args[3], first.rows[0].id, productId],
    );
    expect(generated.rows[0]).toEqual({
      menu_count: 1,
      item_count: 1,
      sold_quantity: 0,
      window_count: 1,
    });

    const incompleteId = "33333333-3333-4333-8333-333333333333";
    const incompleteKey = `${templateId}:sunday:2099-08-17`;
    await database.query(
      `insert into public.weekly_menus (
        id, name, order_cutoff_at, starts_at, ends_at, published,
        auto_generated, generation_key, source_weekly_menu_id
      ) values ($1, $2, $3, $4, $5, true, true, $6, $7)`,
      [
        incompleteId,
        "Incomplete generated week",
        "2099-08-21T04:00:00Z",
        "2099-08-17T04:00:00Z",
        "2099-08-24T03:59:00Z",
        incompleteKey,
        templateId,
      ],
    );
    const repaired = await database.query<{ id: string }>(callSql, [
      templateId,
      incompleteId,
      "Generated Sunday week",
      incompleteKey,
      "2099-08-21T04:00:00Z",
      "2099-08-17T04:00:00Z",
      "2099-08-24T03:59:00Z",
      "Sunday, Aug 23, 3:00 PM-6:00 PM",
      "2099-08-23T19:00:00Z",
      "2099-08-23T22:00:00Z",
      20,
    ]);
    expect(repaired.rows[0].id).toBe(incompleteId);

    const repairedState = await database.query<{
      item_count: number;
      window_count: number;
    }>(
      `select
        (select count(*)::integer from public.weekly_menu_items
          where weekly_menu_id = $1) as item_count,
        (select count(*)::integer from public.delivery_windows
          where weekly_menu_id = $1) as window_count`,
      [incompleteId],
    );
    expect(repairedState.rows[0]).toEqual({ item_count: 1, window_count: 1 });

    const secondProductId = "44444444-4444-4444-8444-444444444444";
    await database.query(
      `insert into public.products (id, name) values ($1, $2)`,
      [secondProductId, "New template loaf"],
    );
    await database.query(
      `insert into public.weekly_menu_items (
        weekly_menu_id, product_id, available_quantity
      ) values ($1, $2, 8)`,
      [templateId, secondProductId],
    );
    await database.query(
      `update public.delivery_windows set reserved = 1
       where weekly_menu_id = $1`,
      [first.rows[0].id],
    );
    await database.query(callSql, [
      templateId,
      first.rows[0].id,
      "Generated Sunday week",
      args[3],
      "2099-08-14T05:00:00Z",
      "2099-08-10T04:00:00Z",
      "2099-08-17T03:59:00Z",
      "Changed reserved delivery label",
      "2099-08-16T20:00:00Z",
      "2099-08-16T22:00:00Z",
      20,
    ]);
    const reservationSafeState = await database.query<{
      cutoff_preserved: boolean;
      label: string;
      item_count: number;
    }>(
      `select
        weekly_menu.order_cutoff_at = $2::timestamptz as cutoff_preserved,
        delivery_window.label,
        (select count(*)::integer from public.weekly_menu_items menu_item
          where menu_item.weekly_menu_id = weekly_menu.id) as item_count
       from public.weekly_menus weekly_menu
       join public.delivery_windows delivery_window
         on delivery_window.weekly_menu_id = weekly_menu.id
       where weekly_menu.id = $1`,
      [first.rows[0].id, "2099-08-14T04:00:00Z"],
    );
    expect(reservationSafeState.rows[0]).toMatchObject({
      cutoff_preserved: true,
      label: "Sunday, Aug 16, 3:00 PM-6:00 PM",
      item_count: 2,
    });
  });

  it("rolls back a new published week if its delivery slot cannot be saved", async () => {
    const templateId = "11111111-1111-4111-8111-111111111111";
    const failedKey = `${templateId}:sunday:2099-08-24`;
    const callSql = `select public.ensure_atomic_rolling_week(
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
    )`;
    const args = [
      templateId,
      null,
      "Rollback test week",
      failedKey,
      "2099-08-28T04:00:00Z",
      "2099-08-24T04:00:00Z",
      "2099-08-31T03:59:00Z",
      "FAIL",
      "2099-08-30T19:00:00Z",
      "2099-08-30T22:00:00Z",
      20,
    ];

    await expect(database.query(callSql, args)).rejects.toThrow();
    const afterFailure = await database.query<{ count: number }>(
      `select count(*)::integer as count
       from public.weekly_menus
       where generation_key = $1`,
      [failedKey],
    );
    expect(afterFailure.rows[0].count).toBe(0);

    await expect(
      database.query(callSql, [
        ...args.slice(0, 7),
        "Sunday, Aug 30, 3:00 PM-6:00 PM",
        ...args.slice(8),
      ]),
    ).resolves.toBeDefined();
  });

  it("exposes the command only to the service role", async () => {
    const signature =
      "public.ensure_atomic_rolling_week(uuid,uuid,text,text,timestamptz,timestamptz,timestamptz,text,timestamptz,timestamptz,integer)";
    const privilege = async (role: string) => {
      const result = await database.query<{ allowed: boolean }>(
        "select has_function_privilege($1, $2, 'EXECUTE') as allowed",
        [role, signature],
      );
      return result.rows[0].allowed;
    };

    await expect(privilege("anon")).resolves.toBe(false);
    await expect(privilege("authenticated")).resolves.toBe(false);
    await expect(privilege("service_role")).resolves.toBe(true);
  });

  it("keeps the migration and application boundary explicit", () => {
    expect(migration).toContain(
      "create or replace function public.ensure_atomic_rolling_week",
    );
    expect(migration).toContain(
      "on conflict (weekly_menu_id, product_id) do nothing",
    );
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");
    expect(rollingWeekSource).toContain(
      'supabase.rpc("ensure_atomic_rolling_week"',
    );
  });
});
