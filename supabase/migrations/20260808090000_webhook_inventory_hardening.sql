-- Keep storefront inventory mutations server-only. PostgreSQL grants EXECUTE
-- on new functions to PUBLIC by default, including SECURITY DEFINER functions.
revoke all on function public.reserve_order_inventory(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.release_order_inventory(uuid)
  from public, anon, authenticated;

grant execute on function public.reserve_order_inventory(uuid, jsonb)
  to service_role;
grant execute on function public.release_order_inventory(uuid)
  to service_role;

-- Stripe retries an event after a timeout or process crash. Reclaim abandoned
-- claims after a short lease so a row left in `processing` cannot lose the
-- payment event forever.
create or replace function public.claim_stripe_event(
  p_event_id text,
  p_event_type text,
  p_object_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_status text;
  existing_updated_at timestamptz;
begin
  insert into processed_stripe_events (
    id,
    event_type,
    object_id,
    status
  )
  values (
    p_event_id,
    p_event_type,
    p_object_id,
    'processing'
  )
  on conflict (id) do nothing;

  if found then
    return true;
  end if;

  select status, updated_at
  into existing_status, existing_updated_at
  from processed_stripe_events
  where id = p_event_id
  for update;

  if existing_status = 'failed'
    or (
      existing_status = 'processing'
      and existing_updated_at < now() - interval '15 minutes'
    )
  then
    update processed_stripe_events
    set status = 'processing',
        attempt_count = attempt_count + 1,
        last_error = null,
        updated_at = now()
    where id = p_event_id;
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.claim_stripe_event(text, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_stripe_event(text, text, text)
  to service_role;
