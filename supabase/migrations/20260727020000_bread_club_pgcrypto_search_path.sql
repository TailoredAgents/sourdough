-- Supabase installs pgcrypto in the extensions schema. Existing deployments of
-- this security-definer function need that trusted schema available so the
-- checkout cancel token can be generated.
do $migration$
begin
  if to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception 'pgcrypto gen_random_bytes(integer) is unavailable';
  end if;
end
$migration$;

alter function public.reserve_bread_club_cycle(uuid, uuid, jsonb)
  set search_path = public, extensions;
