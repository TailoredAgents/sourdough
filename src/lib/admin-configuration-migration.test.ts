import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260808110000_admin_configuration_commands.sql",
  "utf8",
);

const productId = "00000000-0000-4000-8000-000000000001";
const menuItems = [
  {
    product_id: productId,
    available_quantity: 10,
    featured: true,
    unavailable: false,
  },
];
const deliverySettings = {
  center_lat: 34.2,
  center_lng: -84.4,
  radius_miles: 12,
  delivery_fee_cents: 600,
  allowed_postal_codes: ["30114", "30115"],
  service_area_copy: "Delivery is available in the selected local ZIP codes.",
};

describe("admin configuration migration", () => {
  let database: PGlite;
  let weeklyMenuId: string;
  let deliveryWindowId: string;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
      create role anon;
      create role authenticated;
      create role service_role;

      create table public.products (
        id uuid primary key default gen_random_uuid(),
        active boolean not null default true
      );
      create table public.weekly_menus (
        id uuid primary key default gen_random_uuid(),
        name text not null,
        order_cutoff_at timestamptz not null,
        starts_at timestamptz not null,
        ends_at timestamptz not null,
        published boolean not null default false,
        auto_generated boolean not null default false
      );
      create table public.weekly_menu_items (
        id uuid primary key default gen_random_uuid(),
        weekly_menu_id uuid not null references public.weekly_menus(id) on delete cascade,
        product_id uuid not null references public.products(id),
        available_quantity integer not null check (available_quantity >= 0),
        sold_quantity integer not null default 0 check (sold_quantity >= 0),
        featured boolean not null default false,
        unavailable boolean not null default false,
        check (sold_quantity <= available_quantity),
        unique (weekly_menu_id, product_id)
      );
      create table public.delivery_settings (
        id boolean primary key default true,
        center_lat numeric(9,6) not null,
        center_lng numeric(9,6) not null,
        radius_miles numeric(5,2) not null,
        delivery_fee_cents integer not null,
        allowed_postal_codes text[] not null,
        service_area_copy text not null,
        check (id)
      );
      create table public.delivery_windows (
        id uuid primary key default gen_random_uuid(),
        weekly_menu_id uuid not null references public.weekly_menus(id) on delete cascade,
        label text not null,
        starts_at timestamptz not null,
        ends_at timestamptz not null,
        capacity integer not null check (capacity >= 0),
        reserved integer not null default 0 check (reserved >= 0),
        check (reserved <= capacity)
      );
      create table public.orders (
        id uuid primary key default gen_random_uuid(),
        delivery_window_id uuid references public.delivery_windows(id)
      );
      create table public.bread_club_fulfillments (
        id uuid primary key default gen_random_uuid(),
        delivery_window_id uuid not null references public.delivery_windows(id)
      );
    `);
    await database.exec(migration);
    await database.query("insert into public.products (id) values ($1)", [
      productId,
    ]);

    const savedMenu = await database.query<{ id: string }>(
      `select public.admin_save_weekly_menu(
        $1, $2, $3, $4, $5, $6, $7, $8
      ) as id`,
      [
        null,
        "Audit week",
        "2026-08-13T23:59:00Z",
        "2026-08-10T00:00:00Z",
        "2026-08-17T00:00:00Z",
        true,
        JSON.stringify(menuItems),
        "owner@example.com",
      ],
    );
    weeklyMenuId = savedMenu.rows[0].id;

    await database.query(
      "select public.admin_save_delivery_configuration($1, $2, $3, $4)",
      [
        weeklyMenuId,
        JSON.stringify(deliverySettings),
        JSON.stringify([
          {
            id: null,
            label: "Sunday 3-6 PM",
            starts_at: "2026-08-16T19:00:00Z",
            ends_at: "2026-08-16T22:00:00Z",
            capacity: 20,
            remove: false,
          },
        ]),
        "owner@example.com",
      ],
    );
    const savedWindow = await database.query<{ id: string }>(
      "select id from public.delivery_windows where weekly_menu_id = $1",
      [weeklyMenuId],
    );
    deliveryWindowId = savedWindow.rows[0].id;
  }, 20_000);

  afterAll(async () => {
    await database.close();
  });

  it("applies as PostgreSQL and restricts commands to the service role", async () => {
    const anon = await database.query<{ allowed: boolean }>(
      "select has_function_privilege($1, $2, $3) as allowed",
      [
        "anon",
        "public.admin_save_weekly_menu(uuid,text,timestamptz,timestamptz,timestamptz,boolean,jsonb,text)",
        "EXECUTE",
      ],
    );
    const serviceRole = await database.query<{ allowed: boolean }>(
      "select has_function_privilege($1, $2, $3) as allowed",
      [
        "service_role",
        "public.admin_save_weekly_menu(uuid,text,timestamptz,timestamptz,timestamptz,boolean,jsonb,text)",
        "EXECUTE",
      ],
    );
    const anonAuditTable = await database.query<{ allowed: boolean }>(
      "select has_table_privilege($1, $2, $3) as allowed",
      ["anon", "public.admin_configuration_events", "SELECT"],
    );

    expect(anon.rows[0].allowed).toBe(false);
    expect(serviceRole.rows[0].allowed).toBe(true);
    expect(anonAuditTable.rows[0].allowed).toBe(false);
  });

  it("rolls back the entire weekly menu save when inventory is unsafe", async () => {
    await database.query(
      `update public.weekly_menu_items
       set sold_quantity = 2
       where weekly_menu_id = $1`,
      [weeklyMenuId],
    );

    await expect(
      database.query(
        `select public.admin_save_weekly_menu(
          $1, $2, $3, $4, $5, $6, $7, $8
        )`,
        [
          weeklyMenuId,
          "This must roll back",
          "2026-08-13T23:59:00Z",
          "2026-08-10T00:00:00Z",
          "2026-08-17T00:00:00Z",
          true,
          JSON.stringify([{ ...menuItems[0], available_quantity: 1 }]),
          "owner@example.com",
        ],
      ),
    ).rejects.toThrow(/cannot be lower/i);

    const state = await database.query<{
      name: string;
      available_quantity: number;
      sold_quantity: number;
    }>(
      `select menu.name, item.available_quantity, item.sold_quantity
       from public.weekly_menus menu
       join public.weekly_menu_items item on item.weekly_menu_id = menu.id
       where menu.id = $1`,
      [weeklyMenuId],
    );
    expect(state.rows[0]).toEqual({
      name: "Audit week",
      available_quantity: 10,
      sold_quantity: 2,
    });
  });

  it("rolls back settings when a reserved delivery slot cannot be removed", async () => {
    await database.query(
      "update public.delivery_windows set reserved = 1 where id = $1",
      [deliveryWindowId],
    );

    await expect(
      database.query(
        "select public.admin_save_delivery_configuration($1, $2, $3, $4)",
        [
          weeklyMenuId,
          JSON.stringify({ ...deliverySettings, delivery_fee_cents: 700 }),
          JSON.stringify([
            {
              id: deliveryWindowId,
              label: "A changed customer label",
              starts_at: "2026-08-16T19:00:00Z",
              ends_at: "2026-08-16T22:00:00Z",
              capacity: 20,
              remove: false,
            },
          ]),
          "owner@example.com",
        ],
      ),
    ).rejects.toThrow(/cannot be rescheduled or relabeled/i);

    await expect(
      database.query(
        "select public.admin_save_delivery_configuration($1, $2, $3, $4)",
        [
          weeklyMenuId,
          JSON.stringify({ ...deliverySettings, delivery_fee_cents: 700 }),
          JSON.stringify([
            {
              id: deliveryWindowId,
              label: "Sunday 3-6 PM",
              starts_at: "2026-08-16T19:00:00Z",
              ends_at: "2026-08-16T22:00:00Z",
              capacity: 20,
              remove: true,
            },
          ]),
          "owner@example.com",
        ],
      ),
    ).rejects.toThrow(/reserved orders/i);

    const settings = await database.query<{ delivery_fee_cents: number }>(
      "select delivery_fee_cents from public.delivery_settings where id = true",
    );
    const windows = await database.query<{ count: number }>(
      "select count(*)::integer as count from public.delivery_windows where id = $1",
      [deliveryWindowId],
    );
    expect(settings.rows[0].delivery_fee_cents).toBe(600);
    expect(windows.rows[0].count).toBe(1);
  });

  it("preserves unreserved Sunday slots referenced by historical orders", async () => {
    await database.query(
      "update public.delivery_windows set reserved = 0 where id = $1",
      [deliveryWindowId],
    );
    await database.query(
      "insert into public.orders (delivery_window_id) values ($1)",
      [deliveryWindowId],
    );

    await expect(
      database.query(
        "select public.admin_save_delivery_configuration($1, $2, $3, $4)",
        [
          weeklyMenuId,
          JSON.stringify({ ...deliverySettings, delivery_fee_cents: 700 }),
          JSON.stringify([
            {
              id: deliveryWindowId,
              label: "Sunday 3-6 PM",
              starts_at: "2026-08-16T19:00:00Z",
              ends_at: "2026-08-16T22:00:00Z",
              capacity: 20,
              remove: true,
            },
          ]),
          "owner@example.com",
        ],
      ),
    ).rejects.toThrow(/order history cannot be removed/i);

    const settings = await database.query<{ delivery_fee_cents: number }>(
      "select delivery_fee_cents from public.delivery_settings where id = true",
    );
    const windows = await database.query<{ count: number }>(
      "select count(*)::integer as count from public.delivery_windows where id = $1",
      [deliveryWindowId],
    );
    expect(settings.rows[0].delivery_fee_cents).toBe(600);
    expect(windows.rows[0].count).toBe(1);
  });
});
