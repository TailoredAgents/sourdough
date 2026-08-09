-- Serialize each rate-limit bucket in PostgreSQL so concurrent requests cannot
-- all pass a count-then-insert race. The application only receives the result;
-- raw rate-limit rows remain server-only.
create index if not exists rate_limit_events_created_idx
  on public.rate_limit_events(created_at);

create or replace function public.consume_rate_limit(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  remaining integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  event_count integer;
begin
  if nullif(trim(p_scope), '') is null
    or nullif(trim(p_key_hash), '') is null
    or p_limit < 1
    or p_limit > 10000
    or p_window_seconds < 1
    or p_window_seconds > 2592000
  then
    raise exception 'Invalid rate-limit parameters.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_scope || ':' || p_key_hash, 0)
  );

  delete from public.rate_limit_events
  where scope = p_scope
    and key_hash = p_key_hash
    and created_at < now() - pg_catalog.make_interval(secs => p_window_seconds);

  select count(*)::integer
  into event_count
  from public.rate_limit_events
  where scope = p_scope
    and key_hash = p_key_hash
    and created_at >= now() - pg_catalog.make_interval(secs => p_window_seconds);

  if event_count >= p_limit then
    return query select false, 0;
    return;
  end if;

  insert into public.rate_limit_events (scope, key_hash)
  values (p_scope, p_key_hash);

  return query
  select true, pg_catalog.greatest(p_limit - event_count - 1, 0);
end;
$$;

create or replace function public.cleanup_rate_limit_events()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  deleted_count integer;
begin
  with expired as (
    select event.id
    from public.rate_limit_events event
    where event.created_at < now() - interval '31 days'
    order by event.created_at
    limit 10000
  )
  delete from public.rate_limit_events event
  using expired
  where event.id = expired.id;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on table public.rate_limit_events
  from public, anon, authenticated;
revoke all on function public.consume_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.cleanup_rate_limit_events()
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, text, integer, integer)
  to service_role;
grant execute on function public.cleanup_rate_limit_events()
  to service_role;
