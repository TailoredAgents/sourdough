create or replace function public.consume_bread_club_magic_link(
  p_token_hash text,
  p_session_hash text,
  p_session_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  link_row public.bread_club_magic_links%rowtype;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$'
    or p_session_hash !~ '^[0-9a-f]{64}$'
    or p_session_expires_at is null
    or p_session_expires_at <= now()
    or p_session_expires_at > now() + interval '60 days'
  then
    raise exception 'Bread Club magic-link exchange is invalid.';
  end if;

  select *
  into link_row
  from public.bread_club_magic_links
  where token_hash = p_token_hash
  for update;

  if link_row.id is null
    or link_row.used_at is not null
    or link_row.expires_at <= now()
  then
    return null;
  end if;

  update public.bread_club_magic_links
  set used_at = now()
  where id = link_row.id;

  insert into public.bread_club_sessions (
    membership_id,
    session_hash,
    expires_at
  )
  values (
    link_row.membership_id,
    p_session_hash,
    p_session_expires_at
  );

  return link_row.membership_id;
end;
$$;

revoke all on function public.consume_bread_club_magic_link(
  text,
  text,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.consume_bread_club_magic_link(
  text,
  text,
  timestamptz
) to service_role;
