import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const canonicalSchema = readFileSync("supabase/schema.sql", "utf8").replace(
  'create extension if not exists "pgcrypto";',
  "",
);
const checkoutBoundaryMigration = readFileSync(
  "supabase/migrations/20260808114500_bread_club_checkout_boundaries.sql",
  "utf8",
);

describe("Bread Club checkout-boundary migration", () => {
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
    await database.exec(checkoutBoundaryMigration);
  }, 30_000);

  afterAll(async () => {
    await database.close();
  });

  it("installs all fenced Bread Club checkout commands", async () => {
    const result = await database.query<{ function_name: string }>(`
      select procedure.proname as function_name
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname in (
          'create_bread_club_subscription_checkout',
          'attach_bread_club_subscription_checkout',
          'record_bread_club_subscription_checkout_completed',
          'cancel_bread_club_subscription_checkout',
          'create_bread_club_addon_checkout',
          'attach_bread_club_addon_checkout',
          'complete_bread_club_addon_checkout_fenced',
          'cancel_bread_club_addon_checkout'
        )
      order by procedure.proname
    `);

    expect(result.rows.map((row) => row.function_name)).toHaveLength(8);
  });

  it("keeps every new security-definer command service-role only", async () => {
    const exposed = await database.query<{ signature: string }>(`
      select procedure.oid::regprocedure::text as signature
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname like '%bread_club%checkout%'
        and procedure.prosecdef
        and (
          has_function_privilege('anon', procedure.oid, 'EXECUTE')
          or has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
        )
      order by signature
    `);

    expect(exposed.rows).toEqual([]);
  });

  it("contains replay locks, exact session fences, and expire-safe release guards", () => {
    expect(checkoutBoundaryMigration).toContain(
      "bread-club-subscription-attempt:",
    );
    expect(checkoutBoundaryMigration).toContain("bread-club-addon-attempt:");
    expect(checkoutBoundaryMigration).toContain(
      "stripe_checkout_session_id is distinct from p_session_id",
    );
    expect(checkoutBoundaryMigration).toContain(
      "checkout_expires_at > now()",
    );
    expect(checkoutBoundaryMigration).toContain(
      "perform public.release_bread_club_cycle",
    );
    expect(checkoutBoundaryMigration).toContain(
      "perform public.release_bread_club_addon_inventory",
    );
  });
});
