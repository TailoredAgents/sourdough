import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MEMBERSHIP_ID = "71000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "71000000-0000-4000-8000-000000000002";
const CLASSIC_PLAN_ID = "10000000-0000-4000-8000-000000000001";
const VARIETY_PLAN_ID = "10000000-0000-4000-8000-000000000002";
const CLASSIC_PRODUCT_ID = "81000000-0000-4000-8000-000000000001";
const VARIETY_PRODUCT_ID = "81000000-0000-4000-8000-000000000002";

const canonicalSchema = readFileSync("supabase/schema.sql", "utf8").replace(
  'create extension if not exists "pgcrypto";',
  "",
);
const providerSyncMigration = readFileSync(
  "supabase/migrations/20260808131500_bread_club_provider_sync.sql",
  "utf8",
);

describe("Bread Club provider-sync migration", () => {
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
    await database.exec(providerSyncMigration);
    await database.exec(`
      insert into public.products (
        id, slug, name, category, description, price_cents, active
      ) values
        (
          '${CLASSIC_PRODUCT_ID}', 'provider-classic', 'Provider Classic',
          'bread', 'Provider sync fixture', 1100, true
        ),
        (
          '${VARIETY_PRODUCT_ID}', 'provider-variety', 'Provider Variety',
          'bread', 'Provider sync fixture', 1300, true
        );
      insert into public.bread_club_plan_products (
        plan_id, product_id, active, guaranteed
      ) values
        ('${CLASSIC_PLAN_ID}', '${CLASSIC_PRODUCT_ID}', true, true),
        ('${VARIETY_PLAN_ID}', '${CLASSIC_PRODUCT_ID}', true, false),
        ('${VARIETY_PLAN_ID}', '${VARIETY_PRODUCT_ID}', true, false);
      update public.bread_club_plans
      set stripe_price_id = 'price_' || slug,
          stripe_price_cents = price_cents;
      update public.bread_club_delivery_prices
      set stripe_price_id = 'price_delivery_' || replace(band_key, '-', '_'),
          stripe_price_cents = price_cents;
    `);
    await database.query(
      `insert into public.customers (id, name, email, phone)
       values ($1, 'Provider Sync Member', 'provider-sync@example.com', '7705550100')`,
      [CUSTOMER_ID],
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
         stripe_customer_id,
         stripe_subscription_id,
         stripe_plan_subscription_item_id,
         stripe_delivery_subscription_item_id,
         first_delivery_at,
         consent_version,
         consent_text,
         consented_at
       ) values (
         $1,
         $2,
         $3,
         'active',
         '[{"product_id":"${CLASSIC_PRODUCT_ID}","quantity":1}]'::jsonb,
         '{"line1":"1 Old Street","line2":"","city":"Canton","state":"GA","postalCode":"30114","email":"provider-sync@example.com","phone":"7705550100"}'::jsonb,
         '{"eligible":true,"distanceMiles":3}'::jsonb,
         2000,
         '0-10',
         'cus_provider_sync',
         'sub_provider_sync',
         'si_plan_provider_sync',
         'si_delivery_provider_sync',
         now() + interval '7 days',
         '2026-07-26',
         'Provider sync integration-test consent',
         now()
       )`,
      [MEMBERSHIP_ID, CUSTOMER_ID, CLASSIC_PLAN_ID],
    );
  });

  afterAll(async () => {
    await database.close();
  });

  it("snapshots desired prices, serializes workers, and fences renewal", async () => {
    const planChange = await database.query<{ revision: string }>(
      `select public.begin_bread_club_plan_provider_change(
         $1,
         $2,
         '[{"product_id":"${VARIETY_PRODUCT_ID}","quantity":1}]'::jsonb
       )::text as revision`,
      [MEMBERSHIP_ID, VARIETY_PLAN_ID],
    );
    expect(planChange.rows[0]?.revision).toBe("1");

    const firstClaim = await database.query<{
      sync_revision: string;
      sync_claim_token: string;
    }>(
      `select sync_revision::text, sync_claim_token::text
       from public.claim_bread_club_provider_sync($1, 1)`,
      [MEMBERSHIP_ID],
    );
    expect(firstClaim.rows[0]?.sync_revision).toBe("1");
    const firstToken = firstClaim.rows[0]?.sync_claim_token;
    expect(firstToken).toMatch(/^[0-9a-f-]{36}$/i);

    const overlappingClaim = await database.query(
      `select * from public.claim_bread_club_provider_sync($1, 1)`,
      [MEMBERSHIP_ID],
    );
    expect(overlappingClaim.rows).toEqual([]);
    await expect(
      database.query(
        `select public.begin_bread_club_address_provider_change(
           $1,
           '{"line1":"99 New Street","line2":"","city":"Canton","state":"GA","postalCode":"30114","email":"provider-sync@example.com","phone":"7705550100"}'::jsonb,
           'Side porch',
           '{"eligible":true,"preliminary":false,"distanceMiles":8,"durationMinutes":15,"feeCents":700}'::jsonb,
           700,
           '11-20'
         )`,
        [MEMBERSHIP_ID],
      ),
    ).rejects.toThrow(/already synchronizing/i);

    await expect(
      database.query(
        `insert into public.bread_club_cycles (
           membership_id, cycle_number, status, period_start, period_end,
           plan_price_cents, delivery_price_cents, total_cents
         ) values (
           $1, 2, 'pending_payment', now(), now() + interval '28 days',
           5200, 2000, 7200
         )`,
        [MEMBERSHIP_ID],
      ),
    ).rejects.toThrow(/provider changes must finish/i);

    await database.query(
      `insert into public.bread_club_cycles (
         membership_id, cycle_number, status, period_start, period_end,
         plan_price_cents, delivery_price_cents, total_cents
       ) values (
         $1, 1, 'completed', now() - interval '28 days', now(),
         4400, 2000, 6400
       )`,
      [MEMBERSHIP_ID],
    );

    await database.query(
      `update public.bread_club_memberships
       set provider_sync_claimed_at = now() - interval '6 minutes'
       where id = $1`,
      [MEMBERSHIP_ID],
    );
    const addressChange = await database.query<{ revision: string }>(
      `select public.begin_bread_club_address_provider_change(
         $1,
         '{"line1":"99 New Street","line2":"","city":"Canton","state":"GA","postalCode":"30114","email":"provider-sync@example.com","phone":"7705550100"}'::jsonb,
         'Side porch',
         '{"eligible":true,"preliminary":false,"distanceMiles":8,"durationMinutes":15,"feeCents":700}'::jsonb,
         700,
         '11-20'
       )::text as revision`,
      [MEMBERSHIP_ID],
    );
    expect(addressChange.rows[0]?.revision).toBe("2");

    const secondClaim = await database.query<{
      sync_claim_token: string;
    }>(
      `select sync_claim_token::text
       from public.claim_bread_club_provider_sync($1, 2)`,
      [MEMBERSHIP_ID],
    );
    const secondToken = secondClaim.rows[0]?.sync_claim_token;
    expect(secondToken).toMatch(/^[0-9a-f-]{36}$/i);
    expect(secondToken).not.toBe(firstToken);

    const staleFinish = await database.query<{ finished: boolean }>(
      `select public.finish_bread_club_provider_sync(
         $1, 1, $2, null
       ) as finished`,
      [MEMBERSHIP_ID, firstToken],
    );
    expect(staleFinish.rows[0]?.finished).toBe(false);
    const staleState = await database.query<{
      pending_plan_id: string;
      pending_route_band_key: string;
      provider_sync_required: boolean;
      provider_sync_error: string;
      provider_sync_claim_token: string;
      provider_desired_plan_price_id: string;
      provider_desired_plan_price_cents: number;
      provider_desired_delivery_price_id: string;
      provider_desired_delivery_price_cents: number;
      pending_route_fee_cents: number;
      line1: string;
    }>(
      `select
         pending_plan_id::text,
         pending_route_band_key,
         provider_sync_required,
         provider_sync_error,
         provider_sync_claim_token::text,
         provider_desired_plan_price_id,
         provider_desired_plan_price_cents,
         provider_desired_delivery_price_id,
         provider_desired_delivery_price_cents,
         pending_route_fee_cents,
         delivery_address ->> 'line1' as line1
       from public.bread_club_memberships
       where id = $1`,
      [MEMBERSHIP_ID],
    );
    expect(staleState.rows[0]).toMatchObject({
      pending_plan_id: VARIETY_PLAN_ID,
      pending_route_band_key: "11-20",
      provider_sync_required: true,
      provider_sync_error:
        "A superseded provider worker finished; reconciliation is required.",
      provider_sync_claim_token: secondToken,
      provider_desired_plan_price_id: "price_variety",
      provider_desired_plan_price_cents: 5200,
      provider_desired_delivery_price_id: "price_delivery_11_20",
      provider_desired_delivery_price_cents: 2800,
      pending_route_fee_cents: 700,
      line1: "99 New Street",
    });

    const currentFinish = await database.query<{ finished: boolean }>(
      `select public.finish_bread_club_provider_sync(
         $1, 2, $2, null
       ) as finished`,
      [MEMBERSHIP_ID, secondToken],
    );
    expect(currentFinish.rows[0]?.finished).toBe(true);
    const finalState = await database.query<{
      provider_sync_required: boolean;
      provider_sync_error: string | null;
    }>(
      `select provider_sync_required, provider_sync_error
       from public.bread_club_memberships
       where id = $1`,
      [MEMBERSHIP_ID],
    );
    expect(finalState.rows[0]).toEqual({
      provider_sync_required: false,
      provider_sync_error: null,
    });

    await expect(
      database.query(
        `insert into public.bread_club_cycles (
           membership_id, cycle_number, status, period_start, period_end,
           plan_price_cents, delivery_price_cents, total_cents
         ) values (
           $1, 2, 'pending_payment', now(), now() + interval '28 days',
           5200, 2000, 7200
         )`,
        [MEMBERSHIP_ID],
      ),
    ).rejects.toThrow(/delivery pricing does not match/i);

    await database.query(
      `insert into public.bread_club_cycles (
         membership_id, cycle_number, status, period_start, period_end,
         plan_price_cents, delivery_price_cents, total_cents
       ) values (
         $1, 2, 'pending_payment', now(), now() + interval '28 days',
         5200, 2800, 8000
       )`,
      [MEMBERSHIP_ID],
    );
  });

  it("keeps provider-change commands private", async () => {
    const privileges = await database.query<{
      function_name: string;
      role_name: string;
      can_execute: boolean;
    }>(`
      select function_name, role_name, has_function_privilege(
        role_name,
        function_name,
        'EXECUTE'
      ) as can_execute
      from (values
        ('public.begin_bread_club_plan_provider_change(uuid,uuid,jsonb)'),
        ('public.begin_bread_club_address_provider_change(uuid,jsonb,text,jsonb,integer,text)'),
        ('public.claim_bread_club_provider_sync(uuid,bigint)'),
        ('public.finish_bread_club_provider_sync(uuid,bigint,uuid,text)')
      ) functions(function_name)
      cross join (values
        ('anon'),
        ('authenticated'),
        ('service_role')
      ) roles(role_name)
      order by function_name, role_name
    `);
    expect(privileges.rows).toHaveLength(12);
    for (const privilege of privileges.rows) {
      expect(privilege.can_execute).toBe(
        privilege.role_name === "service_role",
      );
    }

    await expect(
      database.exec(`
        set role anon;
        select public.finish_bread_club_provider_sync(
          '${MEMBERSHIP_ID}'::uuid,
          2,
          '90000000-0000-4000-8000-000000000009'::uuid,
          null
        );
      `),
    ).rejects.toThrow(/permission denied/i);
    await database.exec("reset role;");
  });
});
