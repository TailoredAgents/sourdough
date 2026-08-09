alter table public.admin_order_events
  drop constraint if exists admin_order_events_order_id_fkey;

alter table public.admin_order_events
  add constraint admin_order_events_order_id_fkey
  foreign key (order_id) references public.orders(id) on delete restrict;

alter table public.admin_order_events
  drop constraint if exists admin_order_events_actor_email_length_check,
  drop constraint if exists admin_order_events_action_length_check,
  drop constraint if exists admin_order_events_details_object_check;

alter table public.admin_order_events
  add constraint admin_order_events_actor_email_length_check
    check (actor_email is null or char_length(actor_email) <= 320),
  add constraint admin_order_events_action_length_check
    check (char_length(action) between 1 and 80),
  add constraint admin_order_events_details_object_check
    check (jsonb_typeof(details) = 'object');

create or replace function public.admin_finalize_approval_refund(
  p_order_id uuid,
  p_refund_id text,
  p_actor_email text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  order_row public.orders%rowtype;
begin
  if nullif(trim(p_refund_id), '') is null then
    raise exception 'Stripe refund ID is required.';
  end if;

  select *
  into order_row
  from public.orders
  where id = p_order_id
  for update;

  if order_row.id is null then
    raise exception 'Order could not be found.';
  end if;
  if order_row.status <> 'pending_approval' then
    return false;
  end if;

  update public.orders
  set status = 'canceled',
      denied_at = now(),
      refunded_at = now(),
      stripe_refund_id = p_refund_id,
      admin_decision_note = 'Denied approval request and refunded payment.',
      updated_at = now()
  where id = order_row.id;

  insert into public.admin_order_events (
    order_id,
    actor_email,
    action,
    previous_status,
    next_status,
    details
  )
  values (
    order_row.id,
    nullif(trim(p_actor_email), ''),
    'deny_approval_refund',
    order_row.status,
    'canceled',
    jsonb_build_object('stripe_refund_id', p_refund_id)
  );

  return true;
end;
$$;

revoke all on function public.admin_finalize_approval_refund(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_finalize_approval_refund(uuid, text, text)
  to service_role;
