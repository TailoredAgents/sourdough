alter table public.processed_stripe_events
  add column if not exists claim_token uuid,
  add column if not exists lease_expires_at timestamptz;

alter table public.bread_club_job_events
  add column if not exists claim_token uuid,
  add column if not exists lease_expires_at timestamptz;

drop function if exists public.claim_stripe_event(text, text, text);

create function public.claim_stripe_event(
  p_event_id text,
  p_event_type text,
  p_object_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  next_token uuid := gen_random_uuid();
  claimed_token uuid;
begin
  insert into public.processed_stripe_events (
    id,
    event_type,
    object_id,
    status,
    claim_token,
    lease_expires_at
  )
  values (
    p_event_id,
    p_event_type,
    p_object_id,
    'processing',
    next_token,
    now() + interval '15 minutes'
  )
  on conflict (id) do nothing
  returning claim_token into claimed_token;

  if claimed_token is not null then
    return claimed_token;
  end if;

  update public.processed_stripe_events
  set status = 'processing',
      event_type = p_event_type,
      object_id = p_object_id,
      claim_token = next_token,
      lease_expires_at = now() + interval '15 minutes',
      attempt_count = attempt_count + 1,
      last_error = null,
      updated_at = now()
  where id = p_event_id
    and (
      status = 'failed'
      or (
        status = 'processing'
        and coalesce(lease_expires_at, updated_at + interval '15 minutes') <= now()
      )
    )
  returning claim_token into claimed_token;

  return claimed_token;
end;
$$;

create or replace function public.finish_stripe_event(
  p_event_id text,
  p_claim_token uuid,
  p_status text,
  p_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_status not in ('processed', 'failed') then
    raise exception 'Invalid Stripe event completion status.';
  end if;

  update public.processed_stripe_events
  set status = p_status,
      processed_at = case when p_status = 'processed' then now() else null end,
      last_error = case when p_status = 'failed' then p_error_message else null end,
      claim_token = null,
      lease_expires_at = null,
      updated_at = now()
  where id = p_event_id
    and status = 'processing'
    and claim_token = p_claim_token;

  return found;
end;
$$;

create or replace function public.claim_bread_club_job(
  p_job_key text,
  p_job_type text,
  p_membership_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  next_token uuid := gen_random_uuid();
  claimed_token uuid;
begin
  insert into public.bread_club_job_events (
    job_key,
    job_type,
    membership_id,
    status,
    payload,
    claim_token,
    lease_expires_at,
    started_at,
    updated_at
  )
  values (
    p_job_key,
    p_job_type,
    p_membership_id,
    'processing',
    coalesce(p_payload, '{}'::jsonb),
    next_token,
    now() + interval '15 minutes',
    now(),
    now()
  )
  on conflict (job_key) do nothing
  returning claim_token into claimed_token;

  if claimed_token is not null then
    return claimed_token;
  end if;

  update public.bread_club_job_events
  set job_type = p_job_type,
      membership_id = p_membership_id,
      status = 'processing',
      payload = coalesce(p_payload, '{}'::jsonb),
      claim_token = next_token,
      lease_expires_at = now() + interval '15 minutes',
      attempt_count = attempt_count + 1,
      last_error = null,
      started_at = now(),
      completed_at = null,
      updated_at = now()
  where job_key = p_job_key
    and (
      status = 'failed'
      or (
        status = 'processing'
        and coalesce(lease_expires_at, updated_at + interval '15 minutes') <= now()
      )
    )
  returning claim_token into claimed_token;

  return claimed_token;
end;
$$;

create or replace function public.finish_bread_club_job(
  p_job_key text,
  p_claim_token uuid,
  p_status text,
  p_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_status not in ('completed', 'failed') then
    raise exception 'Invalid Bread Club job completion status.';
  end if;

  update public.bread_club_job_events
  set status = p_status,
      completed_at = case when p_status = 'completed' then now() else null end,
      last_error = case when p_status = 'failed' then p_error_message else null end,
      claim_token = null,
      lease_expires_at = null,
      updated_at = now()
  where job_key = p_job_key
    and status = 'processing'
    and claim_token = p_claim_token;

  return found;
end;
$$;

revoke all on function public.claim_stripe_event(text, text, text)
  from public, anon, authenticated;
revoke all on function public.finish_stripe_event(text, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.claim_bread_club_job(text, text, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.finish_bread_club_job(text, uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.claim_stripe_event(text, text, text)
  to service_role;
grant execute on function public.finish_stripe_event(text, uuid, text, text)
  to service_role;
grant execute on function public.claim_bread_club_job(text, text, uuid, jsonb)
  to service_role;
grant execute on function public.finish_bread_club_job(text, uuid, text, text)
  to service_role;
