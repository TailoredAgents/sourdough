create or replace function public.ensure_atomic_bread_club_renewal_cycle(
  p_membership_id uuid,
  p_cycle_number integer,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_plan_price_cents integer,
  p_delivery_price_cents integer,
  p_total_cents integer,
  p_fulfillments jsonb
)
returns table (
  renewal_cycle_id uuid,
  renewal_cycle_number integer,
  replayed boolean,
  repaired boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_membership public.bread_club_memberships%rowtype;
  v_cycle public.bread_club_cycles%rowtype;
  v_pending_cycle_count integer;
  v_next_cycle_number integer;
  v_fulfillment_count integer;
  v_complete_fulfillment_count integer;
begin
  if p_membership_id is null then
    raise exception 'Bread Club membership is required.';
  end if;
  if p_cycle_number is null or p_cycle_number <= 0 then
    raise exception 'Bread Club renewal cycle number is invalid.';
  end if;
  if p_period_start is null
    or p_period_end is null
    or p_period_start >= p_period_end
  then
    raise exception 'Bread Club renewal period is invalid.';
  end if;
  if p_plan_price_cents is null
    or p_plan_price_cents < 0
    or p_delivery_price_cents is null
    or p_delivery_price_cents < 0
    or p_total_cents is null
    or p_total_cents < 0
    or p_total_cents <> p_plan_price_cents + p_delivery_price_cents
  then
    raise exception 'Bread Club renewal pricing is invalid.';
  end if;
  if p_fulfillments is not null and (
    jsonb_typeof(p_fulfillments) <> 'array'
    or jsonb_array_length(p_fulfillments) <> 4
  ) then
    raise exception 'Bread Club renewals require exactly four Sunday deliveries.';
  end if;
  if p_fulfillments is not null and exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_fulfillments) fulfillment(value)
    group by (fulfillment.value ->> 'weekly_menu_id')::uuid
    having count(*) > 1
  ) then
    raise exception 'Bread Club renewal Sundays must be unique.';
  end if;

  -- reserve_bread_club_cycle locks global settings before the membership. Take
  -- that same lock first here so renewal and enrollment writers cannot invert
  -- their lock order.
  perform 1
  from public.bread_club_settings settings
  where settings.id = true
  for update;
  if not found then
    raise exception 'Bread Club settings were not found.';
  end if;

  select membership.*
  into v_membership
  from public.bread_club_memberships membership
  where membership.id = p_membership_id
  for update;
  if not found then
    raise exception 'Bread Club membership was not found.';
  end if;
  if v_membership.status not in ('active', 'past_due') then
    raise exception 'Bread Club membership is not available for renewal.';
  end if;
  if v_membership.pending_plan_id is not null and not exists (
    select 1
    from public.bread_club_plans plan
    where plan.id = v_membership.pending_plan_id
      and plan.active = true
      and plan.price_cents = p_plan_price_cents
  ) then
    raise exception 'Bread Club renewal plan changed while it was being prepared.';
  end if;
  if v_membership.pending_route_fee_cents is not null
    and p_delivery_price_cents <> v_membership.pending_route_fee_cents * 4
  then
    raise exception 'Bread Club renewal delivery price changed while it was being prepared.';
  end if;

  -- Every renewal writer locks the membership first and then all of its cycles
  -- in cycle-number order. Concurrent cron and webhook retries therefore share
  -- one authoritative pending cycle.
  perform cycle.id
  from public.bread_club_cycles cycle
  where cycle.membership_id = p_membership_id
  order by cycle.cycle_number
  for update;

  select count(*)::integer
  into v_pending_cycle_count
  from public.bread_club_cycles cycle
  where cycle.membership_id = p_membership_id
    and cycle.status in ('pending_payment', 'past_due');
  if v_pending_cycle_count > 1 then
    raise exception 'Multiple pending Bread Club renewal cycles require manual repair.';
  end if;

  select cycle.*
  into v_cycle
  from public.bread_club_cycles cycle
  where cycle.membership_id = p_membership_id
    and cycle.status in ('pending_payment', 'past_due')
  order by cycle.cycle_number desc
  limit 1
  for update;

  if v_cycle.id is not null then
    if v_cycle.cycle_number <> p_cycle_number
      or v_cycle.period_start is distinct from p_period_start
      or v_cycle.period_end is distinct from p_period_end
      or v_cycle.plan_price_cents <> p_plan_price_cents
      or v_cycle.delivery_price_cents <> p_delivery_price_cents
      or v_cycle.total_cents <> p_total_cents
    then
      raise exception 'Pending Bread Club renewal details do not match the retry.';
    end if;

    select
      count(*)::integer,
      count(*) filter (
        where fulfillment.membership_id = p_membership_id
          and fulfillment.order_id is not null
          and pg_catalog.jsonb_typeof(fulfillment.selection) = 'array'
          and pg_catalog.jsonb_array_length(fulfillment.selection) > 0
          and exists (
            select 1
            from public.orders bakery_order
            where bakery_order.id = fulfillment.order_id
              and bakery_order.bread_club_fulfillment_id = fulfillment.id
          )
          and exists (
            select 1
            from public.order_items order_item
            where order_item.order_id = fulfillment.order_id
          )
      )::integer
    into v_fulfillment_count, v_complete_fulfillment_count
    from public.bread_club_fulfillments fulfillment
    where fulfillment.cycle_id = v_cycle.id;

    if v_fulfillment_count = 4 and v_complete_fulfillment_count = 4 then
      if p_fulfillments is not null and (
        exists (
          select 1
          from pg_catalog.jsonb_array_elements(p_fulfillments) expected(value)
          where not exists (
            select 1
            from public.bread_club_fulfillments fulfillment
            where fulfillment.cycle_id = v_cycle.id
              and fulfillment.membership_id = p_membership_id
              and fulfillment.weekly_menu_id =
                (expected.value ->> 'weekly_menu_id')::uuid
              and fulfillment.delivery_window_id =
                (expected.value ->> 'delivery_window_id')::uuid
              and fulfillment.selection = expected.value -> 'selection'
          )
        )
        or exists (
          select 1
          from public.bread_club_fulfillments fulfillment
          where fulfillment.cycle_id = v_cycle.id
            and not exists (
              select 1
              from pg_catalog.jsonb_array_elements(p_fulfillments) expected(value)
              where fulfillment.weekly_menu_id =
                (expected.value ->> 'weekly_menu_id')::uuid
                and fulfillment.delivery_window_id =
                  (expected.value ->> 'delivery_window_id')::uuid
                and fulfillment.selection = expected.value -> 'selection'
            )
        )
      ) then
        raise exception 'Pending Bread Club renewal Sundays do not match the retry.';
      end if;

      return query
      select v_cycle.id, v_cycle.cycle_number, true, false;
      return;
    end if;

    if v_fulfillment_count > 0 then
      raise exception 'Pending Bread Club renewal is partially reserved and requires manual repair.';
    end if;
    if v_cycle.status <> 'pending_payment' then
      raise exception 'Past-due Bread Club renewal has no reservations and requires manual repair.';
    end if;
    if p_fulfillments is null then
      raise exception 'Pending Bread Club renewal needs reservation details for repair.';
    end if;

    perform public.reserve_bread_club_cycle(
      p_membership_id,
      v_cycle.id,
      p_fulfillments
    );

    select
      count(*)::integer,
      count(*) filter (
        where fulfillment.membership_id = p_membership_id
          and fulfillment.order_id is not null
      )::integer
    into v_fulfillment_count, v_complete_fulfillment_count
    from public.bread_club_fulfillments fulfillment
    where fulfillment.cycle_id = v_cycle.id;
    if v_fulfillment_count <> 4 or v_complete_fulfillment_count <> 4 then
      raise exception 'Bread Club renewal repair did not create four fulfillment orders.';
    end if;

    return query
    select v_cycle.id, v_cycle.cycle_number, false, true;
    return;
  end if;

  if p_fulfillments is null then
    raise exception 'Bread Club renewal reservation details are required.';
  end if;

  select coalesce(max(cycle.cycle_number), 0) + 1
  into v_next_cycle_number
  from public.bread_club_cycles cycle
  where cycle.membership_id = p_membership_id;
  if p_cycle_number <> v_next_cycle_number then
    raise exception 'Bread Club renewal cycle number is stale.';
  end if;

  insert into public.bread_club_cycles (
    membership_id,
    cycle_number,
    status,
    period_start,
    period_end,
    plan_price_cents,
    delivery_price_cents,
    tax_cents,
    total_cents
  )
  values (
    p_membership_id,
    p_cycle_number,
    'pending_payment',
    p_period_start,
    p_period_end,
    p_plan_price_cents,
    p_delivery_price_cents,
    0,
    p_total_cents
  )
  returning * into v_cycle;

  -- reserve_bread_club_cycle executes inside this function's transaction. Any
  -- inventory, delivery-slot, fulfillment, or order error rolls the cycle back.
  perform public.reserve_bread_club_cycle(
    p_membership_id,
    v_cycle.id,
    p_fulfillments
  );

  select
    count(*)::integer,
    count(*) filter (
      where fulfillment.membership_id = p_membership_id
        and fulfillment.order_id is not null
    )::integer
  into v_fulfillment_count, v_complete_fulfillment_count
  from public.bread_club_fulfillments fulfillment
  where fulfillment.cycle_id = v_cycle.id;
  if v_fulfillment_count <> 4 or v_complete_fulfillment_count <> 4 then
    raise exception 'Bread Club renewal did not create four fulfillment orders.';
  end if;

  return query
  select v_cycle.id, v_cycle.cycle_number, false, false;
end;
$$;

create or replace function public.activate_bread_club_cycle(
  p_cycle_id uuid,
  p_stripe_invoice_id text,
  p_stripe_payment_intent_id text default null,
  p_paid_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_cycle_status text;
  v_fulfillment_count integer;
  v_complete_fulfillment_count integer;
begin
  if p_cycle_id is null
    or char_length(trim(coalesce(p_stripe_invoice_id, ''))) not between 1 and 255
  then
    raise exception 'Bread Club invoice activation is invalid.';
  end if;

  select cycle.status
  into v_cycle_status
  from public.bread_club_cycles cycle
  where cycle.id = p_cycle_id
  for update;
  if not found then
    raise exception 'Bread Club cycle was not found.';
  end if;
  if v_cycle_status not in ('pending_payment', 'past_due', 'paid') then
    raise exception 'Bread Club cycle is not available for invoice activation.';
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where fulfillment.order_id is not null
        and pg_catalog.jsonb_typeof(fulfillment.selection) = 'array'
        and pg_catalog.jsonb_array_length(fulfillment.selection) > 0
        and exists (
          select 1
          from public.orders bakery_order
          where bakery_order.id = fulfillment.order_id
            and bakery_order.bread_club_fulfillment_id = fulfillment.id
        )
        and exists (
          select 1
          from public.order_items order_item
          where order_item.order_id = fulfillment.order_id
        )
    )::integer
  into v_fulfillment_count, v_complete_fulfillment_count
  from public.bread_club_fulfillments fulfillment
  where fulfillment.cycle_id = p_cycle_id;
  if v_fulfillment_count <> 4 or v_complete_fulfillment_count <> 4 then
    raise exception 'Bread Club cycle cannot be activated without four complete fulfillment orders.';
  end if;

  update public.bread_club_cycles
  set status = 'paid',
      stripe_invoice_id = coalesce(
        stripe_invoice_id,
        trim(p_stripe_invoice_id)
      ),
      stripe_payment_intent_id = coalesce(
        stripe_payment_intent_id,
        p_stripe_payment_intent_id
      ),
      paid_at = coalesce(paid_at, p_paid_at),
      updated_at = now()
  where id = p_cycle_id;

  update public.bread_club_fulfillments
  set status = 'scheduled',
      updated_at = now()
  where cycle_id = p_cycle_id
    and status = 'pending_payment';

  update public.orders
  set status = 'paid',
      stripe_invoice_id = coalesce(
        stripe_invoice_id,
        trim(p_stripe_invoice_id)
      ),
      paid_at = coalesce(paid_at, p_paid_at),
      updated_at = now()
  where bread_club_fulfillment_id in (
    select fulfillment.id
    from public.bread_club_fulfillments fulfillment
    where fulfillment.cycle_id = p_cycle_id
  )
    and status = 'pending_payment';
end;
$$;

create or replace function public.operational_schema_healthcheck()
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if to_regprocedure(
    'public.admin_begin_approval_refund(uuid,text)'
  ) is null
    or to_regprocedure(
      'public.attach_storefront_checkout_session(uuid,text)'
    ) is null
    or to_regprocedure(
      'public.claim_order_notification_job(text)'
    ) is null
    or to_regprocedure(
      'public.consume_bread_club_magic_link(text,text,timestamptz)'
    ) is null
    or to_regprocedure(
      'public.ensure_atomic_rolling_week(uuid,uuid,text,text,timestamptz,timestamptz,timestamptz,text,timestamptz,timestamptz,integer)'
    ) is null
    or to_regprocedure(
      'public.ensure_atomic_bread_club_renewal_cycle(uuid,integer,timestamptz,timestamptz,integer,integer,integer,jsonb)'
    ) is null
    or not exists (
      select 1
      from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace
        on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = 'create_bread_club_subscription_checkout'
    )
    or not exists (
      select 1
      from information_schema.columns column_record
      where column_record.table_schema = 'public'
        and column_record.table_name = 'orders'
        and column_record.column_name = 'approval_refund_started_at'
    )
    or not exists (
      select 1
      from information_schema.columns column_record
      where column_record.table_schema = 'public'
        and column_record.table_name = 'orders'
        and column_record.column_name = 'checkout_attempt_id'
    )
    or not exists (
      select 1
      from information_schema.columns column_record
      where column_record.table_schema = 'public'
        and column_record.table_name = 'bread_club_memberships'
        and column_record.column_name = 'checkout_attempt_id'
    )
  then
    raise exception 'Required operational migrations are missing.';
  end if;

  return '20260808124500';
end;
$$;

revoke all on function public.ensure_atomic_bread_club_renewal_cycle(
  uuid,
  integer,
  timestamptz,
  timestamptz,
  integer,
  integer,
  integer,
  jsonb
) from public, anon, authenticated;
revoke all on function public.activate_bread_club_cycle(
  uuid,
  text,
  text,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.operational_schema_healthcheck()
  from public, anon, authenticated;

grant execute on function public.ensure_atomic_bread_club_renewal_cycle(
  uuid,
  integer,
  timestamptz,
  timestamptz,
  integer,
  integer,
  integer,
  jsonb
) to service_role;
grant execute on function public.activate_bread_club_cycle(
  uuid,
  text,
  text,
  timestamptz
) to service_role;
grant execute on function public.operational_schema_healthcheck()
  to service_role;
