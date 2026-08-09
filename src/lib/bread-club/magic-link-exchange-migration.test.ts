import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260808122000_atomic_magic_link_exchange.sql",
  "utf8",
);

const membershipId = "11111111-1111-4111-8111-111111111111";
const consumedTokenHash = "1".repeat(64);
const consumedSessionHash = "2".repeat(64);
const replaySessionHash = "3".repeat(64);
const rollbackTokenHash = "4".repeat(64);
const conflictingSessionHash = "5".repeat(64);
const recoveredSessionHash = "6".repeat(64);

describe("atomic Bread Club magic-link exchange migration", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
      create role anon;
      create role authenticated;
      create role service_role;

      create table public.bread_club_memberships (
        id uuid primary key
      );
      create table public.bread_club_magic_links (
        id uuid primary key default gen_random_uuid(),
        membership_id uuid not null references public.bread_club_memberships(id)
          on delete cascade,
        email text not null,
        token_hash text not null unique,
        request_ip_hash text,
        expires_at timestamptz not null,
        used_at timestamptz,
        created_at timestamptz not null default now()
      );
      create table public.bread_club_sessions (
        id uuid primary key default gen_random_uuid(),
        membership_id uuid not null references public.bread_club_memberships(id)
          on delete cascade,
        session_hash text not null unique,
        expires_at timestamptz not null,
        revoked_at timestamptz,
        last_seen_at timestamptz not null default now(),
        created_at timestamptz not null default now()
      );

      insert into public.bread_club_memberships (id)
      values ('${membershipId}');
    `);
    await database.exec(migration);
  }, 20_000);

  afterAll(async () => {
    await database.close();
  });

  it("atomically consumes a link once and returns null on replay", async () => {
    await database.query(
      `insert into public.bread_club_magic_links (
        membership_id, email, token_hash, expires_at
      ) values ($1, $2, $3, now() + interval '30 minutes')`,
      [membershipId, "member@example.com", consumedTokenHash],
    );

    const consumed = await database.query<{ membership_id: string }>(
      `select public.consume_bread_club_magic_link(
        $1, $2, now() + interval '30 days'
      ) as membership_id`,
      [consumedTokenHash, consumedSessionHash],
    );
    expect(consumed.rows[0].membership_id).toBe(membershipId);

    const replay = await database.query<{ membership_id: string | null }>(
      `select public.consume_bread_club_magic_link(
        $1, $2, now() + interval '30 days'
      ) as membership_id`,
      [consumedTokenHash, replaySessionHash],
    );
    expect(replay.rows[0].membership_id).toBeNull();

    const state = await database.query<{
      link_used: boolean;
      consumed_sessions: number;
      replay_sessions: number;
    }>(
      `select
        (select used_at is not null from public.bread_club_magic_links
          where token_hash = $1) as link_used,
        (select count(*)::integer from public.bread_club_sessions
          where session_hash = $2) as consumed_sessions,
        (select count(*)::integer from public.bread_club_sessions
          where session_hash = $3) as replay_sessions`,
      [consumedTokenHash, consumedSessionHash, replaySessionHash],
    );
    expect(state.rows[0]).toEqual({
      link_used: true,
      consumed_sessions: 1,
      replay_sessions: 0,
    });
  });

  it("rolls back used_at when the session insert conflicts", async () => {
    await database.query(
      `insert into public.bread_club_magic_links (
        membership_id, email, token_hash, expires_at
      ) values ($1, $2, $3, now() + interval '30 minutes')`,
      [membershipId, "member@example.com", rollbackTokenHash],
    );
    await database.query(
      `insert into public.bread_club_sessions (
        membership_id, session_hash, expires_at
      ) values ($1, $2, now() + interval '30 days')`,
      [membershipId, conflictingSessionHash],
    );

    await expect(
      database.query(
        `select public.consume_bread_club_magic_link(
          $1, $2, now() + interval '30 days'
        )`,
        [rollbackTokenHash, conflictingSessionHash],
      ),
    ).rejects.toThrow(/unique|duplicate/i);

    const afterConflict = await database.query<{
      used_at: string | null;
      session_count: number;
    }>(
      `select
        (select used_at from public.bread_club_magic_links
          where token_hash = $1) as used_at,
        (select count(*)::integer from public.bread_club_sessions
          where session_hash = $2) as session_count`,
      [rollbackTokenHash, conflictingSessionHash],
    );
    expect(afterConflict.rows[0]).toEqual({
      used_at: null,
      session_count: 1,
    });

    const recovered = await database.query<{ membership_id: string }>(
      `select public.consume_bread_club_magic_link(
        $1, $2, now() + interval '30 days'
      ) as membership_id`,
      [rollbackTokenHash, recoveredSessionHash],
    );
    expect(recovered.rows[0].membership_id).toBe(membershipId);
  });

  it("allows only the service role to execute the exchange", async () => {
    const signature =
      "public.consume_bread_club_magic_link(text,text,timestamptz)";
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
});
