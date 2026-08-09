alter table public.orders
  add column if not exists approval_refund_started_at timestamptz;

create or replace function public.protect_claimed_approval_refund()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if old.status = 'pending_approval'
    and old.approval_refund_started_at is not null
  then
    if new.approval_refund_started_at is null then
      raise exception 'An approval refund claim cannot be cleared.';
    end if;
    if (
      new.status is distinct from old.status
      or new.delivery_window_id is distinct from old.delivery_window_id
    ) and new.status <> 'canceled'
    then
      raise exception 'This approval request has a Stripe refund in progress.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_claimed_approval_refund on public.orders;
create trigger protect_claimed_approval_refund
before update on public.orders
for each row
execute function public.protect_claimed_approval_refund();

create or replace function public.admin_begin_approval_refund(
  p_order_id uuid,
  p_actor_email text default null
)
returns table (
  checkout_session_id text,
  refund_id text
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  order_row public.orders%rowtype;
begin
  if p_order_id is null
    or char_length(coalesce(p_actor_email, '')) > 320
  then
    raise exception 'Approval refund request is invalid.';
  end if;

  select *
  into order_row
  from public.orders
  where id = p_order_id
  for update;

  if order_row.id is null then
    raise exception 'Order could not be found.';
  end if;
  if order_row.source <> 'storefront'
    or order_row.status <> 'pending_approval'
  then
    raise exception 'Only paid storefront approval requests can be refunded.';
  end if;
  if nullif(trim(order_row.stripe_checkout_session_id), '') is null then
    raise exception 'Order does not have a Stripe Checkout session to refund.';
  end if;

  if order_row.approval_refund_started_at is null then
    update public.orders
    set approval_refund_started_at = now(),
        admin_decision_note = 'Stripe refund started; confirmation pending.',
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
      'begin_approval_refund',
      order_row.status,
      order_row.status,
      jsonb_build_object(
        'stripe_checkout_session_id', order_row.stripe_checkout_session_id
      )
    );
  end if;

  return query
  select order_row.stripe_checkout_session_id, order_row.stripe_refund_id;
end;
$$;

create or replace function public.admin_record_approval_refund(
  p_order_id uuid,
  p_refund_id text,
  p_refund_status text,
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
  if p_order_id is null
    or nullif(trim(p_refund_id), '') is null
    or char_length(p_refund_id) > 255
    or nullif(trim(p_refund_status), '') is null
    or char_length(p_refund_status) > 80
    or char_length(coalesce(p_actor_email, '')) > 320
  then
    raise exception 'Stripe refund state is invalid.';
  end if;

  select *
  into order_row
  from public.orders
  where id = p_order_id
  for update;

  if order_row.id is null then
    raise exception 'Order could not be found.';
  end if;
  if order_row.status <> 'pending_approval'
    or order_row.approval_refund_started_at is null
  then
    return false;
  end if;

  update public.orders
  set stripe_refund_id = trim(p_refund_id),
      admin_decision_note = left(
        'Stripe refund ' || trim(p_refund_status) || '; confirmation pending.',
        500
      ),
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
    'record_approval_refund',
    order_row.status,
    order_row.status,
    jsonb_build_object(
      'stripe_refund_id', trim(p_refund_id),
      'stripe_refund_status', trim(p_refund_status)
    )
  );

  return true;
end;
$$;

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
  if p_order_id is null
    or nullif(trim(p_refund_id), '') is null
    or char_length(p_refund_id) > 255
    or char_length(coalesce(p_actor_email, '')) > 320
  then
    raise exception 'Stripe refund finalization is invalid.';
  end if;

  select *
  into order_row
  from public.orders
  where id = p_order_id
  for update;

  if order_row.id is null then
    raise exception 'Order could not be found.';
  end if;
  if order_row.status <> 'pending_approval'
    or order_row.approval_refund_started_at is null
  then
    return false;
  end if;

  update public.orders
  set status = 'canceled',
      denied_at = now(),
      refunded_at = now(),
      stripe_refund_id = trim(p_refund_id),
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
    jsonb_build_object('stripe_refund_id', trim(p_refund_id))
  );

  return true;
end;
$$;

revoke all on function public.protect_claimed_approval_refund()
  from public, anon, authenticated;
revoke all on function public.admin_begin_approval_refund(uuid, text)
  from public, anon, authenticated;
revoke all on function public.admin_record_approval_refund(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.admin_finalize_approval_refund(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.admin_begin_approval_refund(uuid, text)
  to service_role;
grant execute on function public.admin_record_approval_refund(uuid, text, text, text)
  to service_role;
grant execute on function public.admin_finalize_approval_refund(uuid, text, text)
  to service_role;
