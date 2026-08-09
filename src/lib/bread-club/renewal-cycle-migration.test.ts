import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260808124500_atomic_bread_club_renewal_cycle.sql",
  "utf8",
);

const renewalSql = `select *
  from public.ensure_atomic_bread_club_renewal_cycle(
    $1, $2, $3, $4, $5, $6, $7, $8
  )`;

function fulfillmentInput(seed: number, failAfterFirst = false) {
  return Array.from({ length: 4 }, (_, index) => {
    const suffix = String(seed * 10 + index + 1).padStart(12, "0");
    return {
      weekly_menu_id: `30000000-0000-4000-8000-${suffix}`,
      delivery_window_id: `40000000-0000-4000-8000-${suffix}`,
      selection: [
        {
          product_id: "20000000-0000-4000-8000-000000000001",
          quantity: 1,
        },
      ],
      fail_after_insert: failAfterFirst && index === 0,
    };
  });
}

describe("atomic Bread Club renewal-cycle migration", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
      create role anon;
      create role authenticated;
      create role service_role;

      create table public.bread_club_memberships (
        id uuid primary key,
        status text not null,
        checkout_attempt_id uuid,
        pending_plan_id uuid,
        pending_route_fee_cents integer
      );
      create table public.bread_club_plans (
        id uuid primary key,
        active boolean not null,
        price_cents integer not null
      );
      create table public.bread_club_settings (
        id boolean primary key
      );
      insert into public.bread_club_settings (id) values (true);
      create table public.bread_club_cycles (
        id uuid primary key default gen_random_uuid(),
        membership_id uuid not null references public.bread_club_memberships(id),
        cycle_number integer not null,
        status text not null,
        period_start timestamptz not null,
        period_end timestamptz not null,
        plan_price_cents integer not null,
        delivery_price_cents integer not null,
        tax_cents integer not null default 0,
        total_cents integer not null,
        stripe_invoice_id text,
        stripe_payment_intent_id text,
        paid_at timestamptz,
        updated_at timestamptz not null default now(),
        unique (membership_id, cycle_number)
      );
      create table public.orders (
        id uuid primary key default gen_random_uuid(),
        status text not null default 'pending_payment',
        bread_club_fulfillment_id uuid,
        stripe_invoice_id text,
        paid_at timestamptz,
        updated_at timestamptz not null default now(),
        approval_refund_started_at timestamptz,
        checkout_attempt_id uuid
      );
      create table public.bread_club_fulfillments (
        id uuid primary key default gen_random_uuid(),
        membership_id uuid not null references public.bread_club_memberships(id),
        cycle_id uuid not null references public.bread_club_cycles(id),
        weekly_menu_id uuid not null,
        delivery_window_id uuid not null,
        order_id uuid references public.orders(id),
        status text not null default 'pending_payment',
        selection jsonb not null,
        updated_at timestamptz not null default now(),
        unique (membership_id, weekly_menu_id)
      );
      create table public.order_items (
        id uuid primary key default gen_random_uuid(),
        order_id uuid not null references public.orders(id),
        product_id uuid not null,
        quantity integer not null
      );

      create function public.reserve_bread_club_cycle(
        p_membership_id uuid,
        p_cycle_id uuid,
        p_fulfillments jsonb
      ) returns jsonb
      language plpgsql
      security definer
      set search_path = pg_catalog, public, pg_temp
      as $$
      declare
        fulfillment jsonb;
        v_fulfillment_id uuid;
        v_order_id uuid;
      begin
        for fulfillment in
          select value
          from pg_catalog.jsonb_array_elements(p_fulfillments)
        loop
          insert into public.bread_club_fulfillments (
            membership_id,
            cycle_id,
            weekly_menu_id,
            delivery_window_id,
            selection
          ) values (
            p_membership_id,
            p_cycle_id,
            (fulfillment ->> 'weekly_menu_id')::uuid,
            (fulfillment ->> 'delivery_window_id')::uuid,
            fulfillment -> 'selection'
          ) returning id into v_fulfillment_id;

          insert into public.orders (bread_club_fulfillment_id)
          values (v_fulfillment_id)
          returning id into v_order_id;
          update public.bread_club_fulfillments
          set order_id = v_order_id
          where id = v_fulfillment_id;
          insert into public.order_items (order_id, product_id, quantity)
          values (
            v_order_id,
            ((fulfillment -> 'selection' -> 0) ->> 'product_id')::uuid,
            ((fulfillment -> 'selection' -> 0) ->> 'quantity')::integer
          );

          if coalesce((fulfillment ->> 'fail_after_insert')::boolean, false) then
            raise exception 'simulated reservation failure';
          end if;
        end loop;
        return '[]'::jsonb;
      end;
      $$;

      create function public.admin_begin_approval_refund(uuid, text)
      returns boolean language sql as $$ select true $$;
      create function public.attach_storefront_checkout_session(uuid, text)
      returns boolean language sql as $$ select true $$;
      create function public.claim_order_notification_job(text)
      returns boolean language sql as $$ select true $$;
      create function public.consume_bread_club_magic_link(
        text, text, timestamptz
      ) returns boolean language sql as $$ select true $$;
      create function public.ensure_atomic_rolling_week(
        uuid, uuid, text, text, timestamptz, timestamptz, timestamptz,
        text, timestamptz, timestamptz, integer
      ) returns uuid language sql as $$ select null::uuid $$;
      create function public.create_bread_club_subscription_checkout()
      returns boolean language sql as $$ select true $$;
    `);
    await database.exec(migration);
  }, 20_000);

  afterAll(async () => {
    await database.close();
  });

  async function insertMembership(id: string) {
    await database.query(
      `insert into public.bread_club_memberships (id, status)
       values ($1, 'active')`,
      [id],
    );
  }

  function renewalArguments(membershipId: string, fulfillments: unknown) {
    return [
      membershipId,
      1,
      "2099-08-01T00:00:00Z",
      "2099-08-29T00:00:00Z",
      5200,
      2800,
      8000,
      JSON.stringify(fulfillments),
    ];
  }

  it("creates four reservations once and safely replays the same renewal", async () => {
    const membershipId = "50000000-0000-4000-8000-000000000001";
    const fulfillments = fulfillmentInput(1);
    await insertMembership(membershipId);

    const first = await database.query<{
      renewal_cycle_id: string;
      renewal_cycle_number: number;
      replayed: boolean;
      repaired: boolean;
    }>(renewalSql, renewalArguments(membershipId, fulfillments));
    const replay = await database.query<{
      renewal_cycle_id: string;
      replayed: boolean;
    }>(renewalSql, renewalArguments(membershipId, fulfillments));

    expect(replay.rows[0]).toMatchObject({
      renewal_cycle_id: first.rows[0].renewal_cycle_id,
      replayed: true,
    });
    expect(first.rows[0]).toMatchObject({
      renewal_cycle_number: 1,
      replayed: false,
      repaired: false,
    });
    const counts = await database.query<{
      cycles: number;
      fulfillments: number;
      orders: number;
    }>(
      `select
        (select count(*)::integer from public.bread_club_cycles
          where membership_id = $1) as cycles,
        (select count(*)::integer from public.bread_club_fulfillments
          where membership_id = $1) as fulfillments,
        (select count(*)::integer from public.orders bakery_order
          join public.bread_club_fulfillments fulfillment
            on fulfillment.order_id = bakery_order.id
          where fulfillment.membership_id = $1) as orders`,
      [membershipId],
    );
    expect(counts.rows[0]).toEqual({ cycles: 1, fulfillments: 4, orders: 4 });

    await database.query(
      `select public.activate_bread_club_cycle($1, $2, null, now())`,
      [first.rows[0].renewal_cycle_id, "in_complete_cycle"],
    );
    const activated = await database.query<{
      cycle_status: string;
      scheduled_fulfillments: number;
      paid_orders: number;
    }>(
      `select
        (select status from public.bread_club_cycles where id = $1)
          as cycle_status,
        (select count(*)::integer from public.bread_club_fulfillments
          where cycle_id = $1 and status = 'scheduled')
          as scheduled_fulfillments,
        (select count(*)::integer from public.orders bakery_order
          join public.bread_club_fulfillments fulfillment
            on fulfillment.order_id = bakery_order.id
          where fulfillment.cycle_id = $1 and bakery_order.status = 'paid')
          as paid_orders`,
      [first.rows[0].renewal_cycle_id],
    );
    expect(activated.rows[0]).toEqual({
      cycle_status: "paid",
      scheduled_fulfillments: 4,
      paid_orders: 4,
    });
  });

  it("rolls the cycle and every partial reservation back on failure", async () => {
    const membershipId = "50000000-0000-4000-8000-000000000002";
    await insertMembership(membershipId);

    await expect(
      database.query(
        renewalSql,
        renewalArguments(membershipId, fulfillmentInput(2, true)),
      ),
    ).rejects.toThrow(/simulated reservation failure/i);
    const counts = await database.query<{ cycles: number; fulfillments: number }>(
      `select
        (select count(*)::integer from public.bread_club_cycles
          where membership_id = $1) as cycles,
        (select count(*)::integer from public.bread_club_fulfillments
          where membership_id = $1) as fulfillments`,
      [membershipId],
    );
    expect(counts.rows[0]).toEqual({ cycles: 0, fulfillments: 0 });
  });

  it("repairs an empty legacy cycle and rejects a partially reserved one", async () => {
    const emptyMembershipId = "50000000-0000-4000-8000-000000000003";
    const partialMembershipId = "50000000-0000-4000-8000-000000000004";
    await insertMembership(emptyMembershipId);
    await insertMembership(partialMembershipId);
    const insertCycle = `insert into public.bread_club_cycles (
      membership_id, cycle_number, status, period_start, period_end,
      plan_price_cents, delivery_price_cents, total_cents
    ) values ($1, 1, 'pending_payment', $2, $3, 5200, 2800, 8000)
    returning id`;
    await database.query(insertCycle, [
      emptyMembershipId,
      "2099-08-01T00:00:00Z",
      "2099-08-29T00:00:00Z",
    ]);
    const repaired = await database.query<{ repaired: boolean }>(
      renewalSql,
      renewalArguments(emptyMembershipId, fulfillmentInput(3)),
    );
    expect(repaired.rows[0].repaired).toBe(true);

    const partialCycle = await database.query<{ id: string }>(insertCycle, [
      partialMembershipId,
      "2099-08-01T00:00:00Z",
      "2099-08-29T00:00:00Z",
    ]);
    const partial = fulfillmentInput(4)[0];
    const partialFulfillment = await database.query<{ id: string }>(
      `insert into public.bread_club_fulfillments (
        membership_id, cycle_id, weekly_menu_id, delivery_window_id, selection
      ) values ($1, $2, $3, $4, $5::jsonb) returning id`,
      [
        partialMembershipId,
        partialCycle.rows[0].id,
        partial.weekly_menu_id,
        partial.delivery_window_id,
        JSON.stringify(partial.selection),
      ],
    );
    const partialOrder = await database.query<{ id: string }>(
      `insert into public.orders (bread_club_fulfillment_id)
       values ($1) returning id`,
      [partialFulfillment.rows[0].id],
    );
    await database.query(
      `update public.bread_club_fulfillments set order_id = $1 where id = $2`,
      [partialOrder.rows[0].id, partialFulfillment.rows[0].id],
    );
    await database.query(
      `insert into public.order_items (order_id, product_id, quantity)
       values ($1, $2, 1)`,
      [partialOrder.rows[0].id, partial.selection[0].product_id],
    );

    await expect(
      database.query(
        renewalSql,
        renewalArguments(partialMembershipId, fulfillmentInput(4)),
      ),
    ).rejects.toThrow(/partially reserved.*manual repair/i);
    const partialCount = await database.query<{ count: number }>(
      `select count(*)::integer as count
       from public.bread_club_fulfillments
       where membership_id = $1`,
      [partialMembershipId],
    );
    expect(partialCount.rows[0].count).toBe(1);
  });

  it("blocks invoice activation for an incomplete renewal cycle", async () => {
    const membershipId = "50000000-0000-4000-8000-000000000005";
    await insertMembership(membershipId);
    const cycle = await database.query<{ id: string }>(
      `insert into public.bread_club_cycles (
        membership_id, cycle_number, status, period_start, period_end,
        plan_price_cents, delivery_price_cents, total_cents
      ) values ($1, 1, 'pending_payment', $2, $3, 5200, 2800, 8000)
      returning id`,
      [
        membershipId,
        "2099-08-01T00:00:00Z",
        "2099-08-29T00:00:00Z",
      ],
    );

    await expect(
      database.query(
        `select public.activate_bread_club_cycle($1, $2, null, now())`,
        [cycle.rows[0].id, "in_incomplete_cycle"],
      ),
    ).rejects.toThrow(/four complete fulfillment orders/i);
  });

  it("keeps the renewal command server-only and advances schema health", async () => {
    const signature =
      "public.ensure_atomic_bread_club_renewal_cycle(uuid,integer,timestamptz,timestamptz,integer,integer,integer,jsonb)";
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
    const health = await database.query<{ version: string }>(
      `select public.operational_schema_healthcheck() as version`,
    );
    expect(health.rows[0].version).toBe("20260808124500");
  });
});
