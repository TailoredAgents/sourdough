import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";

let database: PGlite;

beforeAll(async () => {
  database = new PGlite();
  await database.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.rate_limit_events (
      id uuid primary key default gen_random_uuid(),
      scope text not null,
      key_hash text not null,
      created_at timestamptz not null default now()
    );
  `);
  await database.exec(readFileSync("supabase/migrations/20260808094500_atomic_rate_limits.sql", "utf8"));
  await database.exec(readFileSync("supabase/migrations/20261112153000_fix_rate_limit_remaining.sql", "utf8"));
}, 20_000);

afterAll(async () => database.close());

it("allows valid requests, decrements remaining, and denies after the limit", async () => {
  const consume = () => database.query("select * from public.consume_rate_limit('delivery_address_check', 'synthetic-key', 2, 3600)");
  expect((await consume()).rows).toEqual([{ allowed: true, remaining: 1 }]);
  expect((await consume()).rows).toEqual([{ allowed: true, remaining: 0 }]);
  expect((await consume()).rows).toEqual([{ allowed: false, remaining: 0 }]);
  const count = await database.query("select count(*)::integer as count from public.rate_limit_events");
  expect(count.rows).toEqual([{ count: 2 }]);
});

it("preserves the API role execution restrictions", async () => {
  const result = await database.query(`
    select
      has_function_privilege('anon', 'public.consume_rate_limit(text,text,integer,integer)', 'EXECUTE') as anon,
      has_function_privilege('authenticated', 'public.consume_rate_limit(text,text,integer,integer)', 'EXECUTE') as authenticated,
      has_function_privilege('service_role', 'public.consume_rate_limit(text,text,integer,integer)', 'EXECUTE') as service_role
  `);
  expect(result.rows).toEqual([{ anon: false, authenticated: false, service_role: true }]);
});
