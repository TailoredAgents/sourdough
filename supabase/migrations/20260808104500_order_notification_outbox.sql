create table if not exists public.order_notification_jobs (
  job_key text primary key,
  order_id uuid not null references public.orders(id) on delete restrict,
  notification_type text not null
    check (notification_type in ('completion_thank_you')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  claim_token uuid,
  lease_expires_at timestamptz,
  available_at timestamptz not null default now(),
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists order_notification_jobs_ready_idx
  on public.order_notification_jobs(status, available_at, updated_at);

alter table public.order_notification_jobs enable row level security;

create or replace function public.enqueue_order_completion_notification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.status = 'delivered' and old.status is distinct from new.status then
    insert into public.order_notification_jobs (
      job_key,
      order_id,
      notification_type
    )
    values (
      'completion-thank-you:' || new.id::text,
      new.id,
      'completion_thank_you'
    )
    on conflict (job_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists enqueue_order_completion_notification
  on public.orders;
create trigger enqueue_order_completion_notification
after update of status on public.orders
for each row
execute function public.enqueue_order_completion_notification();

create or replace function public.claim_order_notification_job(
  p_job_key text
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
  update public.order_notification_jobs
  set status = 'processing',
      attempt_count = attempt_count + 1,
      claim_token = next_token,
      lease_expires_at = now() + interval '15 minutes',
      last_error = null,
      updated_at = now()
  where job_key = p_job_key
    and (
      (status in ('pending', 'failed') and available_at <= now())
      or (
        status = 'processing'
        and coalesce(lease_expires_at, updated_at + interval '15 minutes') <= now()
      )
    )
  returning claim_token into claimed_token;

  return claimed_token;
end;
$$;

create or replace function public.finish_order_notification_job(
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
    raise exception 'Invalid order notification completion status.';
  end if;

  update public.order_notification_jobs
  set status = p_status,
      claim_token = null,
      lease_expires_at = null,
      available_at = case
        when p_status = 'failed'
          then now() + least(attempt_count * interval '5 minutes', interval '1 hour')
        else available_at
      end,
      last_error = case when p_status = 'failed' then p_error_message else null end,
      completed_at = case when p_status = 'completed' then now() else null end,
      updated_at = now()
  where job_key = p_job_key
    and status = 'processing'
    and claim_token = p_claim_token;

  return found;
end;
$$;

revoke all on table public.order_notification_jobs
  from public, anon, authenticated;
revoke all on function public.enqueue_order_completion_notification()
  from public, anon, authenticated;
revoke all on function public.claim_order_notification_job(text)
  from public, anon, authenticated;
revoke all on function public.finish_order_notification_job(text, uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.claim_order_notification_job(text)
  to service_role;
grant execute on function public.finish_order_notification_job(text, uuid, text, text)
  to service_role;
