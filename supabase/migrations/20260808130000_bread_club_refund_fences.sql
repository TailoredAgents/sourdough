alter table public.bread_club_cycles
  add column if not exists refund_started_at timestamptz,
  add column if not exists stripe_refund_status text,
  add column if not exists refund_attempt_count integer not null default 0,
  add column if not exists refund_attempt_key text,
  add column if not exists refund_last_error text,
  add column if not exists refund_previous_status text;

alter table public.bread_club_cycles
  drop constraint if exists bread_club_cycles_stripe_refund_status_check;
alter table public.bread_club_cycles
  add constraint bread_club_cycles_stripe_refund_status_check
  check (
    stripe_refund_status is null
    or stripe_refund_status in (
      'unknown',
      'pending',
      'requires_action',
      'succeeded',
      'failed',
      'canceled'
    )
  );

alter table public.bread_club_cycles
  drop constraint if exists bread_club_cycles_refund_attempt_count_check;
alter table public.bread_club_cycles
  add constraint bread_club_cycles_refund_attempt_count_check
  check (refund_attempt_count >= 0);

alter table public.bread_club_cycles
  drop constraint if exists bread_club_cycles_refund_previous_status_check;
alter table public.bread_club_cycles
  add constraint bread_club_cycles_refund_previous_status_check
  check (
    refund_previous_status is null
    or refund_previous_status in ('paid', 'past_due')
  );

alter table public.bread_club_rollover_credits
  add column if not exists stripe_refund_id text,
  add column if not exists stripe_refund_status text,
  add column if not exists refund_started_at timestamptz,
  add column if not exists refund_attempt_count integer not null default 0,
  add column if not exists refund_attempt_key text,
  add column if not exists refund_last_error text;

alter table public.bread_club_rollover_credits
  drop constraint if exists bread_club_rollover_credits_status_check;
alter table public.bread_club_rollover_credits
  add constraint bread_club_rollover_credits_status_check
  check (
    status in (
      'available',
      'redeemed',
      'expired',
      'refund_pending',
      'refunded'
    )
  );

alter table public.bread_club_rollover_credits
  drop constraint if exists bread_club_rollover_credits_stripe_refund_status_check;
alter table public.bread_club_rollover_credits
  add constraint bread_club_rollover_credits_stripe_refund_status_check
  check (
    stripe_refund_status is null
    or stripe_refund_status in (
      'unknown',
      'pending',
      'requires_action',
      'succeeded',
      'failed',
      'canceled'
    )
  );

alter table public.bread_club_rollover_credits
  drop constraint if exists bread_club_rollover_credits_refund_attempt_count_check;
alter table public.bread_club_rollover_credits
  add constraint bread_club_rollover_credits_refund_attempt_count_check
  check (refund_attempt_count >= 0);

create index if not exists bread_club_cycles_refund_reconciliation_idx
  on public.bread_club_cycles(status, stripe_refund_status, updated_at)
  where status = 'refund_pending';

create index if not exists bread_club_credits_refund_reconciliation_idx
  on public.bread_club_rollover_credits(
    status,
    stripe_refund_status,
    updated_at
  )
  where status = 'refund_pending';

create or replace function public.protect_bread_club_cycle_refund_claim()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.status = 'refunded'
    and old.status is distinct from 'refunded'
    and (
      new.stripe_refund_status is distinct from 'succeeded'
      or nullif(trim(new.stripe_refund_id), '') is null
    )
  then
    raise exception 'A Bread Club cycle can only be marked refunded after Stripe reports success.';
  end if;

  if old.status = 'refund_pending' then
    if new.status not in ('refund_pending', 'refunded') then
      raise exception 'A claimed Bread Club cycle refund cannot be moved or cleared.';
    end if;
    if new.refund_started_at is null
      or nullif(trim(new.refund_attempt_key), '') is null
      or new.refund_attempt_count < old.refund_attempt_count
    then
      raise exception 'A Bread Club cycle refund claim cannot be cleared.';
    end if;
    if new.refund_attempt_count > old.refund_attempt_count
      and nullif(trim(old.refund_attempt_key), '') is not null
      and old.stripe_refund_status is distinct from 'failed'
      and old.stripe_refund_status is distinct from 'canceled'
    then
      raise exception 'A Bread Club cycle refund attempt is still reconcilable.';
    end if;
    if new.membership_id is distinct from old.membership_id
      or new.period_start is distinct from old.period_start
      or new.period_end is distinct from old.period_end
      or new.plan_price_cents is distinct from old.plan_price_cents
      or new.delivery_price_cents is distinct from old.delivery_price_cents
      or new.tax_cents is distinct from old.tax_cents
      or new.total_cents is distinct from old.total_cents
      or new.stripe_invoice_id is distinct from old.stripe_invoice_id
      or new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id
    then
      raise exception 'A claimed Bread Club cycle refund cannot be rebilled or reassigned.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_bread_club_cycle_refund_claim
  on public.bread_club_cycles;
create trigger protect_bread_club_cycle_refund_claim
before update on public.bread_club_cycles
for each row execute function public.protect_bread_club_cycle_refund_claim();

create or replace function public.protect_bread_club_credit_refund_claim()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.status = 'refunded'
    and old.status is distinct from 'refunded'
    and (
      new.stripe_refund_status is distinct from 'succeeded'
      or nullif(trim(new.stripe_refund_id), '') is null
    )
  then
    raise exception 'A rollover credit can only be marked refunded after Stripe reports success.';
  end if;

  if old.status = 'refund_pending' then
    if new.status not in ('refund_pending', 'refunded') then
      raise exception 'A claimed rollover-credit refund cannot be redeemed, expired, or cleared.';
    end if;
    if new.refund_started_at is null
      or nullif(trim(new.refund_attempt_key), '') is null
      or new.refund_attempt_count < old.refund_attempt_count
    then
      raise exception 'A rollover-credit refund claim cannot be cleared.';
    end if;
    if new.refund_attempt_count > old.refund_attempt_count
      and nullif(trim(old.refund_attempt_key), '') is not null
      and old.stripe_refund_status is distinct from 'failed'
      and old.stripe_refund_status is distinct from 'canceled'
    then
      raise exception 'A rollover-credit refund attempt is still reconcilable.';
    end if;
    if new.membership_id is distinct from old.membership_id
      or new.source_fulfillment_id is distinct from old.source_fulfillment_id
      or new.quantity is distinct from old.quantity
      or new.delivery_fee_credit_cents is distinct from old.delivery_fee_credit_cents
      or new.expires_at is distinct from old.expires_at
      or new.redeemed_fulfillment_id is distinct from old.redeemed_fulfillment_id
      or new.stripe_invoice_item_id is distinct from old.stripe_invoice_item_id
      or new.delivery_credit_applied_at is distinct from old.delivery_credit_applied_at
    then
      raise exception 'A claimed rollover-credit refund cannot be redeemed, rebilled, or reassigned.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_bread_club_credit_refund_claim
  on public.bread_club_rollover_credits;
create trigger protect_bread_club_credit_refund_claim
before update on public.bread_club_rollover_credits
for each row execute function public.protect_bread_club_credit_refund_claim();

create or replace function public.protect_bread_club_fulfillment_during_refund()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  cycle_row public.bread_club_cycles%rowtype;
begin
  select *
  into cycle_row
  from public.bread_club_cycles
  where id = old.cycle_id;

  if cycle_row.status = 'refund_pending'
    and cycle_row.stripe_refund_status is distinct from 'succeeded'
    and (
      new.status is distinct from old.status
      or new.membership_id is distinct from old.membership_id
      or new.cycle_id is distinct from old.cycle_id
      or new.weekly_menu_id is distinct from old.weekly_menu_id
      or new.delivery_window_id is distinct from old.delivery_window_id
      or new.order_id is distinct from old.order_id
      or new.selection is distinct from old.selection
      or new.selection_locked_at is distinct from old.selection_locked_at
      or new.skipped_at is distinct from old.skipped_at
    )
  then
    raise exception 'This Bread Club cycle has a Stripe refund in progress.';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_bread_club_fulfillment_during_refund
  on public.bread_club_fulfillments;
create trigger protect_bread_club_fulfillment_during_refund
before update on public.bread_club_fulfillments
for each row execute function public.protect_bread_club_fulfillment_during_refund();

create or replace function public.protect_bread_club_order_during_refund()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  cycle_refund_status text;
  cycle_status text;
begin
  if old.bread_club_fulfillment_id is null then
    return new;
  end if;

  select cycle.status, cycle.stripe_refund_status
  into cycle_status, cycle_refund_status
  from public.bread_club_fulfillments fulfillment
  join public.bread_club_cycles cycle on cycle.id = fulfillment.cycle_id
  where fulfillment.id = old.bread_club_fulfillment_id;

  if cycle_status = 'refund_pending'
    and cycle_refund_status is distinct from 'succeeded'
    and (
      new.status is distinct from old.status
      or new.source is distinct from old.source
      or new.bread_club_membership_id is distinct from old.bread_club_membership_id
      or new.bread_club_fulfillment_id is distinct from old.bread_club_fulfillment_id
      or new.delivery_window_id is distinct from old.delivery_window_id
      or new.delivery_address is distinct from old.delivery_address
      or new.delivery_instructions is distinct from old.delivery_instructions
    )
  then
    raise exception 'This Bread Club cycle has a Stripe refund in progress.';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_bread_club_order_during_refund
  on public.orders;
create trigger protect_bread_club_order_during_refund
before update on public.orders
for each row execute function public.protect_bread_club_order_during_refund();

create or replace function public.protect_bread_club_order_item_during_refund()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  target_order_id uuid;
  previous_order_id uuid;
  refund_claimed boolean;
begin
  if tg_op = 'DELETE' then
    target_order_id := old.order_id;
    previous_order_id := old.order_id;
  elsif tg_op = 'UPDATE' then
    target_order_id := new.order_id;
    previous_order_id := old.order_id;
  else
    target_order_id := new.order_id;
    previous_order_id := new.order_id;
  end if;

  select exists (
    select 1
    from public.orders bakery_order
    join public.bread_club_fulfillments fulfillment
      on fulfillment.id = bakery_order.bread_club_fulfillment_id
    join public.bread_club_cycles cycle on cycle.id = fulfillment.cycle_id
    where bakery_order.id in (target_order_id, previous_order_id)
      and cycle.status = 'refund_pending'
      and cycle.stripe_refund_status is distinct from 'succeeded'
  )
  into refund_claimed;

  if refund_claimed then
    raise exception 'This Bread Club cycle has a Stripe refund in progress.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_bread_club_order_item_during_refund
  on public.order_items;
create trigger protect_bread_club_order_item_during_refund
before insert or update or delete on public.order_items
for each row execute function public.protect_bread_club_order_item_during_refund();

create or replace function public.protect_bread_club_addon_during_refund()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  target_fulfillment_id uuid;
  previous_fulfillment_id uuid;
  protected_cycle_status text;
begin
  if tg_op = 'INSERT' then
    target_fulfillment_id := new.fulfillment_id;
    previous_fulfillment_id := new.fulfillment_id;
  elsif tg_op = 'UPDATE' then
    target_fulfillment_id := new.fulfillment_id;
    previous_fulfillment_id := old.fulfillment_id;
  else
    target_fulfillment_id := old.fulfillment_id;
    previous_fulfillment_id := old.fulfillment_id;
  end if;

  select cycle.status
  into protected_cycle_status
  from public.bread_club_fulfillments fulfillment
  join public.bread_club_cycles cycle on cycle.id = fulfillment.cycle_id
  where fulfillment.id in (
    target_fulfillment_id,
    previous_fulfillment_id
  )
    and cycle.status in ('refund_pending', 'refunded')
  order by cycle.id
  limit 1
  for key share of cycle;

  if protected_cycle_status is not null then
    raise exception 'This Bread Club cycle has a full-cycle refund in progress or completed.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_bread_club_addon_during_refund
  on public.bread_club_addon_checkouts;
create trigger protect_bread_club_addon_during_refund
before insert or update or delete on public.bread_club_addon_checkouts
for each row execute function public.protect_bread_club_addon_during_refund();

create or replace function public.begin_bread_club_credit_refund_attempt(
  p_credit_id uuid
)
returns table (
  refund_state text,
  attempt_key text,
  refund_id text,
  provider_status text,
  membership_id uuid,
  stripe_invoice_id text,
  stripe_invoice_item_id text,
  amount_cents integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  credit_row public.bread_club_rollover_credits%rowtype;
  cycle_row public.bread_club_cycles%rowtype;
  membership_row public.bread_club_memberships%rowtype;
  credit_membership_id uuid;
  source_cycle_id uuid;
  next_attempt integer;
  next_attempt_key text;
  refund_amount integer;
begin
  select credit.membership_id, fulfillment.cycle_id
  into credit_membership_id, source_cycle_id
  from public.bread_club_rollover_credits credit
  join public.bread_club_fulfillments fulfillment
    on fulfillment.id = credit.source_fulfillment_id
  where credit.id = p_credit_id;

  if source_cycle_id is null then
    raise exception 'A refundable rollover credit was not found.';
  end if;

  select *
  into membership_row
  from public.bread_club_memberships
  where id = credit_membership_id
  for share;

  if membership_row.id is null then
    raise exception 'The rollover credit membership was not found.';
  end if;

  select *
  into cycle_row
  from public.bread_club_cycles
  where id = source_cycle_id
  for update;

  select *
  into credit_row
  from public.bread_club_rollover_credits
  where id = p_credit_id
  for update;

  if credit_row.id is null
    or credit_row.status not in (
      'available',
      'expired',
      'refund_pending',
      'refunded'
    )
    or (
      credit_row.status in ('available', 'expired')
      and not (
        credit_row.expires_at > now()
        or (
          membership_row.status = 'canceled'
          and membership_row.canceled_at is not null
          and membership_row.canceled_at < credit_row.expires_at
        )
      )
    )
  then
    raise exception 'That rollover credit is not refundable.';
  end if;

  refund_amount := (cycle_row.plan_price_cents / 4)
    + case
        when credit_row.delivery_credit_applied_at is null
          then credit_row.delivery_fee_credit_cents
        else 0
      end;

  if credit_row.status = 'refunded' then
    return query select
      credit_row.status,
      credit_row.refund_attempt_key,
      credit_row.stripe_refund_id,
      credit_row.stripe_refund_status,
      credit_row.membership_id,
      cycle_row.stripe_invoice_id,
      credit_row.stripe_invoice_item_id,
      refund_amount;
    return;
  end if;

  if cycle_row.status in ('refund_pending', 'refunded') then
    raise exception 'The source cycle already has a full-cycle refund claim.';
  end if;

  if credit_row.status = 'refund_pending'
    and nullif(trim(credit_row.refund_attempt_key), '') is not null
    and credit_row.stripe_refund_status is distinct from 'failed'
    and credit_row.stripe_refund_status is distinct from 'canceled'
  then
    return query select
      credit_row.status,
      credit_row.refund_attempt_key,
      credit_row.stripe_refund_id,
      credit_row.stripe_refund_status,
      credit_row.membership_id,
      cycle_row.stripe_invoice_id,
      credit_row.stripe_invoice_item_id,
      refund_amount;
    return;
  end if;

  next_attempt := credit_row.refund_attempt_count + 1;
  next_attempt_key := format(
    'bread-club-credit-refund:%s:%s',
    credit_row.id,
    next_attempt
  );

  update public.bread_club_rollover_credits
  set status = 'refund_pending',
      refund_started_at = now(),
      refund_attempt_count = next_attempt,
      refund_attempt_key = next_attempt_key,
      stripe_refund_id = case
        when nullif(trim(credit_row.refund_attempt_key), '') is null
          then credit_row.stripe_refund_id
        else null
      end,
      stripe_refund_status = case
        when nullif(trim(credit_row.refund_attempt_key), '') is null
          and credit_row.stripe_refund_id is not null
          then coalesce(credit_row.stripe_refund_status, 'unknown')
        else null
      end,
      refund_last_error = null,
      updated_at = now()
  where id = credit_row.id
  returning * into credit_row;

  return query select
    credit_row.status,
    credit_row.refund_attempt_key,
    credit_row.stripe_refund_id,
    credit_row.stripe_refund_status,
    credit_row.membership_id,
    cycle_row.stripe_invoice_id,
    credit_row.stripe_invoice_item_id,
    refund_amount;
end;
$$;

create or replace function public.record_bread_club_credit_refund(
  p_credit_id uuid,
  p_attempt_key text,
  p_stripe_refund_id text,
  p_stripe_refund_status text,
  p_last_error text default null
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  credit_row public.bread_club_rollover_credits%rowtype;
  normalized_status text := lower(trim(p_stripe_refund_status));
begin
  if nullif(trim(p_attempt_key), '') is null
    or nullif(trim(p_stripe_refund_id), '') is null
    or normalized_status not in (
      'pending',
      'requires_action',
      'succeeded',
      'failed',
      'canceled'
    )
  then
    raise exception 'The Stripe rollover-credit refund result is invalid.';
  end if;

  select *
  into credit_row
  from public.bread_club_rollover_credits
  where id = p_credit_id
  for update;

  if credit_row.id is null
    or credit_row.status not in ('refund_pending', 'refunded')
    or credit_row.refund_attempt_key is distinct from trim(p_attempt_key)
  then
    raise exception 'The rollover-credit refund claim is stale or missing.';
  end if;

  if credit_row.status = 'refunded' then
    if credit_row.stripe_refund_id is distinct from trim(p_stripe_refund_id) then
      raise exception 'The rollover credit was finalized with a different Stripe refund.';
    end if;
    return credit_row.status;
  end if;

  update public.bread_club_rollover_credits
  set status = case
        when normalized_status = 'succeeded' then 'refunded'
        else 'refund_pending'
      end,
      stripe_refund_id = trim(p_stripe_refund_id),
      stripe_refund_status = normalized_status,
      refunded_at = case
        when normalized_status = 'succeeded' then coalesce(refunded_at, now())
        else null
      end,
      refund_last_error = nullif(left(coalesce(p_last_error, ''), 2000), ''),
      updated_at = now()
  where id = credit_row.id
  returning status into normalized_status;

  return normalized_status;
end;
$$;

create or replace function public.record_bread_club_credit_refund_error(
  p_credit_id uuid,
  p_attempt_key text,
  p_last_error text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if nullif(trim(p_attempt_key), '') is null
    or nullif(trim(p_last_error), '') is null
  then
    raise exception 'A durable rollover-credit refund error is required.';
  end if;

  update public.bread_club_rollover_credits
  set stripe_refund_status = 'unknown',
      refund_last_error = left(trim(p_last_error), 2000),
      updated_at = now()
  where id = p_credit_id
    and status = 'refund_pending'
    and refund_attempt_key = trim(p_attempt_key);

  if not found then
    raise exception 'The rollover-credit refund claim is stale or missing.';
  end if;
end;
$$;

create or replace function public.begin_bread_club_cycle_refund_attempt(
  p_cycle_id uuid
)
returns table (
  refund_state text,
  attempt_key text,
  refund_id text,
  provider_status text,
  membership_id uuid,
  stripe_invoice_id text,
  stripe_invoice_item_ids text[],
  amount_cents integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  cycle_row public.bread_club_cycles%rowtype;
  next_attempt integer;
  next_attempt_key text;
begin
  select *
  into cycle_row
  from public.bread_club_cycles
  where id = p_cycle_id
    and status in ('paid', 'past_due', 'refund_pending', 'refunded')
  for update;

  if cycle_row.id is null then
    raise exception 'A refundable Bread Club cycle was not found.';
  end if;

  perform 1
  from public.bread_club_fulfillments
  where cycle_id = p_cycle_id
  order by id
  for update;

  perform 1
  from public.orders
  where bread_club_fulfillment_id in (
    select id
    from public.bread_club_fulfillments
    where cycle_id = p_cycle_id
  )
  order by id
  for update;

  perform 1
  from public.bread_club_rollover_credits credit
  where credit.source_fulfillment_id in (
    select id
    from public.bread_club_fulfillments
    where cycle_id = p_cycle_id
  )
  order by credit.id
  for update;

  perform addon.id
  from public.bread_club_addon_checkouts addon
  join public.bread_club_fulfillments fulfillment
    on fulfillment.id = addon.fulfillment_id
  where fulfillment.cycle_id = p_cycle_id
  order by addon.id
  for update of addon;

  if cycle_row.status = 'refunded' then
    return query select
      cycle_row.status,
      cycle_row.refund_attempt_key,
      cycle_row.stripe_refund_id,
      cycle_row.stripe_refund_status,
      cycle_row.membership_id,
      cycle_row.stripe_invoice_id,
      array(
        select credit.stripe_invoice_item_id
        from public.bread_club_rollover_credits credit
        join public.bread_club_fulfillments fulfillment
          on fulfillment.id = credit.source_fulfillment_id
        where fulfillment.cycle_id = cycle_row.id
          and credit.stripe_invoice_item_id is not null
        order by credit.id
      ),
      cycle_row.total_cents;
    return;
  end if;

  if exists (
    select 1
    from public.bread_club_fulfillments fulfillment
    join public.orders bakery_order on bakery_order.id = fulfillment.order_id
    where fulfillment.cycle_id = p_cycle_id
      and bakery_order.status in ('baking', 'out_for_delivery', 'delivered')
  ) then
    raise exception 'This cycle already contains a delivery in production or completed.';
  end if;

  if exists (
    select 1
    from public.bread_club_rollover_credits credit
    join public.bread_club_fulfillments fulfillment
      on fulfillment.id = credit.source_fulfillment_id
    where fulfillment.cycle_id = p_cycle_id
      and (
        credit.status in ('redeemed', 'refund_pending', 'refunded')
        or credit.delivery_credit_applied_at is not null
        or credit.stripe_refund_id is not null
      )
  ) then
    raise exception 'This cycle has a rollover or delivery credit that was already used or refunding.';
  end if;

  if exists (
    select 1
    from public.bread_club_addon_checkouts addon
    join public.bread_club_fulfillments fulfillment
      on fulfillment.id = addon.fulfillment_id
    where fulfillment.cycle_id = p_cycle_id
      and addon.status in ('pending_payment', 'paid')
  ) then
    raise exception 'This cycle has an open or paid add-on that must be resolved before a full-cycle refund.';
  end if;

  if cycle_row.status = 'refund_pending'
    and nullif(trim(cycle_row.refund_attempt_key), '') is not null
    and cycle_row.stripe_refund_status is distinct from 'failed'
    and cycle_row.stripe_refund_status is distinct from 'canceled'
  then
    return query select
      cycle_row.status,
      cycle_row.refund_attempt_key,
      cycle_row.stripe_refund_id,
      cycle_row.stripe_refund_status,
      cycle_row.membership_id,
      cycle_row.stripe_invoice_id,
      array(
        select credit.stripe_invoice_item_id
        from public.bread_club_rollover_credits credit
        join public.bread_club_fulfillments fulfillment
          on fulfillment.id = credit.source_fulfillment_id
        where fulfillment.cycle_id = cycle_row.id
          and credit.stripe_invoice_item_id is not null
        order by credit.id
      ),
      cycle_row.total_cents;
    return;
  end if;

  next_attempt := cycle_row.refund_attempt_count + 1;
  next_attempt_key := format(
    'bread-club-cycle-refund:%s:%s',
    cycle_row.id,
    next_attempt
  );

  update public.bread_club_cycles
  set status = 'refund_pending',
      refund_started_at = now(),
      refund_attempt_count = next_attempt,
      refund_attempt_key = next_attempt_key,
      refund_previous_status = coalesce(
        refund_previous_status,
        case
          when cycle_row.status in ('paid', 'past_due') then cycle_row.status
          else 'paid'
        end
      ),
      stripe_refund_id = case
        when nullif(trim(cycle_row.refund_attempt_key), '') is null
          then cycle_row.stripe_refund_id
        else null
      end,
      stripe_refund_status = case
        when nullif(trim(cycle_row.refund_attempt_key), '') is null
          and cycle_row.stripe_refund_id is not null
          then coalesce(cycle_row.stripe_refund_status, 'unknown')
        else null
      end,
      refund_last_error = null,
      updated_at = now()
  where id = cycle_row.id
  returning * into cycle_row;

  return query select
    cycle_row.status,
    cycle_row.refund_attempt_key,
    cycle_row.stripe_refund_id,
    cycle_row.stripe_refund_status,
    cycle_row.membership_id,
    cycle_row.stripe_invoice_id,
    array(
      select credit.stripe_invoice_item_id
      from public.bread_club_rollover_credits credit
      join public.bread_club_fulfillments fulfillment
        on fulfillment.id = credit.source_fulfillment_id
      where fulfillment.cycle_id = cycle_row.id
        and credit.stripe_invoice_item_id is not null
      order by credit.id
    ),
    cycle_row.total_cents;
end;
$$;

create or replace function public.record_bread_club_cycle_refund(
  p_cycle_id uuid,
  p_attempt_key text,
  p_stripe_refund_id text,
  p_stripe_refund_status text,
  p_admin_note text default null,
  p_last_error text default null
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  cycle_row public.bread_club_cycles%rowtype;
  fulfillment_row record;
  normalized_status text := lower(trim(p_stripe_refund_status));
begin
  if nullif(trim(p_attempt_key), '') is null
    or nullif(trim(p_stripe_refund_id), '') is null
    or normalized_status not in (
      'pending',
      'requires_action',
      'succeeded',
      'failed',
      'canceled'
    )
  then
    raise exception 'The Stripe cycle refund result is invalid.';
  end if;

  select *
  into cycle_row
  from public.bread_club_cycles
  where id = p_cycle_id
  for update;

  if cycle_row.id is null
    or cycle_row.status not in ('refund_pending', 'refunded')
    or cycle_row.refund_attempt_key is distinct from trim(p_attempt_key)
  then
    raise exception 'The Bread Club cycle refund claim is stale or missing.';
  end if;

  if cycle_row.status = 'refunded' then
    if cycle_row.stripe_refund_id is distinct from trim(p_stripe_refund_id) then
      raise exception 'The Bread Club cycle was finalized with a different Stripe refund.';
    end if;
    return cycle_row.status;
  end if;

  update public.bread_club_cycles
  set stripe_refund_id = trim(p_stripe_refund_id),
      stripe_refund_status = normalized_status,
      admin_note = coalesce(nullif(trim(p_admin_note), ''), admin_note),
      refund_last_error = nullif(left(coalesce(p_last_error, ''), 2000), ''),
      updated_at = now()
  where id = cycle_row.id;

  if normalized_status <> 'succeeded' then
    return 'refund_pending';
  end if;

  perform 1
  from public.bread_club_fulfillments
  where cycle_id = p_cycle_id
  order by id
  for update;

  perform 1
  from public.orders
  where bread_club_fulfillment_id in (
    select id
    from public.bread_club_fulfillments
    where cycle_id = p_cycle_id
  )
  order by id
  for update;

  perform 1
  from public.bread_club_rollover_credits credit
  where credit.source_fulfillment_id in (
    select id
    from public.bread_club_fulfillments
    where cycle_id = p_cycle_id
  )
  order by credit.id
  for update;

  perform addon.id
  from public.bread_club_addon_checkouts addon
  join public.bread_club_fulfillments fulfillment
    on fulfillment.id = addon.fulfillment_id
  where fulfillment.cycle_id = p_cycle_id
  order by addon.id
  for update of addon;

  if exists (
    select 1
    from public.bread_club_fulfillments fulfillment
    join public.orders bakery_order on bakery_order.id = fulfillment.order_id
    where fulfillment.cycle_id = p_cycle_id
      and bakery_order.status in ('baking', 'out_for_delivery', 'delivered')
  ) then
    raise exception 'This cycle entered production before its refund could finalize.';
  end if;

  if exists (
    select 1
    from public.bread_club_rollover_credits credit
    join public.bread_club_fulfillments fulfillment
      on fulfillment.id = credit.source_fulfillment_id
    where fulfillment.cycle_id = p_cycle_id
      and (
        credit.status in ('redeemed', 'refund_pending', 'refunded')
        or credit.delivery_credit_applied_at is not null
        or credit.stripe_refund_id is not null
      )
  ) then
    raise exception 'This cycle developed a used or separately refunded credit before finalization.';
  end if;

  if exists (
    select 1
    from public.bread_club_addon_checkouts addon
    join public.bread_club_fulfillments fulfillment
      on fulfillment.id = addon.fulfillment_id
    where fulfillment.cycle_id = p_cycle_id
      and addon.status in ('pending_payment', 'paid')
  ) then
    raise exception 'This cycle developed an open or paid add-on before refund finalization.';
  end if;

  for fulfillment_row in
    select id, order_id
    from public.bread_club_fulfillments
    where cycle_id = p_cycle_id
      and status in ('pending_payment', 'scheduled')
    order by id
    for update
  loop
    perform public.release_order_inventory(fulfillment_row.order_id);

    update public.orders
    set status = 'canceled',
        refunded_at = now(),
        stripe_refund_id = trim(p_stripe_refund_id),
        admin_decision_note = p_admin_note,
        updated_at = now()
    where id = fulfillment_row.order_id;

    update public.bread_club_fulfillments
    set status = 'canceled',
        updated_at = now()
    where id = fulfillment_row.id;
  end loop;

  update public.bread_club_rollover_credits credit
  set status = 'refunded',
      refunded_at = now(),
      refund_started_at = coalesce(credit.refund_started_at, cycle_row.refund_started_at),
      refund_attempt_count = greatest(credit.refund_attempt_count, 1),
      refund_attempt_key = coalesce(credit.refund_attempt_key, trim(p_attempt_key)),
      stripe_refund_id = trim(p_stripe_refund_id),
      stripe_refund_status = 'succeeded',
      refund_last_error = null,
      updated_at = now()
  from public.bread_club_fulfillments fulfillment
  where fulfillment.id = credit.source_fulfillment_id
    and fulfillment.cycle_id = p_cycle_id
    and credit.status in ('available', 'expired');

  update public.bread_club_cycles
  set status = 'refunded',
      refunded_at = now(),
      stripe_refund_id = trim(p_stripe_refund_id),
      stripe_refund_status = 'succeeded',
      admin_note = coalesce(nullif(trim(p_admin_note), ''), admin_note),
      refund_last_error = null,
      updated_at = now()
  where id = cycle_row.id;

  return 'refunded';
end;
$$;

create or replace function public.record_bread_club_cycle_refund_error(
  p_cycle_id uuid,
  p_attempt_key text,
  p_last_error text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if nullif(trim(p_attempt_key), '') is null
    or nullif(trim(p_last_error), '') is null
  then
    raise exception 'A durable Bread Club cycle refund error is required.';
  end if;

  update public.bread_club_cycles
  set stripe_refund_status = 'unknown',
      refund_last_error = left(trim(p_last_error), 2000),
      updated_at = now()
  where id = p_cycle_id
    and status = 'refund_pending'
    and refund_attempt_key = trim(p_attempt_key);

  if not found then
    raise exception 'The Bread Club cycle refund claim is stale or missing.';
  end if;
end;
$$;

create or replace function public.release_bread_club_cycle(
  p_cycle_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  cycle_row public.bread_club_cycles%rowtype;
  fulfillment_row record;
begin
  select *
  into cycle_row
  from public.bread_club_cycles
  where id = p_cycle_id
  for update;

  if cycle_row.id is null
    or cycle_row.status not in ('pending_payment', 'past_due')
  then
    return;
  end if;

  perform 1
  from public.bread_club_fulfillments
  where cycle_id = p_cycle_id
  order by id
  for update;

  perform 1
  from public.orders
  where bread_club_fulfillment_id in (
    select id
    from public.bread_club_fulfillments
    where cycle_id = p_cycle_id
  )
  order by id
  for update;

  for fulfillment_row in
    select id, order_id
    from public.bread_club_fulfillments
    where cycle_id = p_cycle_id
      and status = 'pending_payment'
    order by id
  loop
    perform public.release_order_inventory(fulfillment_row.order_id);

    update public.orders
    set status = 'canceled',
        updated_at = now()
    where id = fulfillment_row.order_id
      and status = 'pending_payment';

    update public.bread_club_fulfillments
    set status = 'canceled',
        updated_at = now()
    where id = fulfillment_row.id
      and status = 'pending_payment';
  end loop;

  update public.bread_club_cycles
  set status = 'canceled',
      updated_at = now()
  where id = cycle_row.id
    and status in ('pending_payment', 'past_due');
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
  cycle_row public.bread_club_cycles%rowtype;
  fulfillment_count integer;
  activatable_fulfillment_count integer;
begin
  if p_cycle_id is null
    or char_length(trim(coalesce(p_stripe_invoice_id, ''))) not between 1 and 255
  then
    raise exception 'Bread Club invoice activation is invalid.';
  end if;

  select *
  into cycle_row
  from public.bread_club_cycles
  where id = p_cycle_id
  for update;
  if cycle_row.id is null then
    raise exception 'Bread Club cycle was not found.';
  end if;
  if cycle_row.status not in ('pending_payment', 'past_due', 'paid') then
    raise exception 'Bread Club cycle is not available for invoice activation.';
  end if;
  if cycle_row.stripe_invoice_id is not null
    and cycle_row.stripe_invoice_id is distinct from trim(p_stripe_invoice_id)
  then
    raise exception 'Bread Club cycle is attached to a different Stripe invoice.';
  end if;

  if cycle_row.status = 'paid' then
    return;
  end if;

  perform 1
  from public.bread_club_fulfillments
  where cycle_id = p_cycle_id
  order by id
  for update;

  perform 1
  from public.orders
  where bread_club_fulfillment_id in (
    select id
    from public.bread_club_fulfillments
    where cycle_id = p_cycle_id
  )
  order by id
  for update;

  select
    count(*)::integer,
    count(*) filter (
      where fulfillment.status = 'pending_payment'
        and fulfillment.order_id is not null
        and pg_catalog.jsonb_typeof(fulfillment.selection) = 'array'
        and pg_catalog.jsonb_array_length(fulfillment.selection) > 0
        and exists (
          select 1
          from public.orders bakery_order
          where bakery_order.id = fulfillment.order_id
            and bakery_order.bread_club_fulfillment_id = fulfillment.id
            and bakery_order.status = 'pending_payment'
        )
        and exists (
          select 1
          from public.order_items order_item
          where order_item.order_id = fulfillment.order_id
        )
    )::integer
  into fulfillment_count, activatable_fulfillment_count
  from public.bread_club_fulfillments fulfillment
  where fulfillment.cycle_id = p_cycle_id;

  if fulfillment_count <> 4 or activatable_fulfillment_count <> 4 then
    raise exception 'Bread Club cycle cannot be activated without four reserved pending fulfillment orders.';
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
      paid_at = coalesce(paid_at, p_paid_at, now()),
      updated_at = now()
  where id = cycle_row.id;

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
      paid_at = coalesce(paid_at, p_paid_at, now()),
      updated_at = now()
  where bread_club_fulfillment_id in (
    select fulfillment.id
    from public.bread_club_fulfillments fulfillment
    where fulfillment.cycle_id = p_cycle_id
  )
    and status = 'pending_payment';
end;
$$;

create or replace function public.begin_bread_club_cycle_refund(
  p_cycle_id uuid
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  claim_row record;
begin
  select *
  into claim_row
  from public.begin_bread_club_cycle_refund_attempt(p_cycle_id);

  return claim_row.refund_state;
end;
$$;

create or replace function public.refund_bread_club_cycle(
  p_cycle_id uuid,
  p_stripe_refund_id text,
  p_admin_note text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  cycle_row public.bread_club_cycles%rowtype;
begin
  select *
  into cycle_row
  from public.bread_club_cycles
  where id = p_cycle_id
  for update;

  if cycle_row.status = 'refunded'
    and cycle_row.stripe_refund_status = 'succeeded'
    and cycle_row.stripe_refund_id = trim(p_stripe_refund_id)
  then
    return;
  end if;

  raise exception 'Use the durable Bread Club refund-attempt command to finalize Stripe refunds.';
end;
$$;

revoke all on function public.protect_bread_club_cycle_refund_claim()
  from public, anon, authenticated;
revoke all on function public.protect_bread_club_credit_refund_claim()
  from public, anon, authenticated;
revoke all on function public.protect_bread_club_fulfillment_during_refund()
  from public, anon, authenticated;
revoke all on function public.protect_bread_club_order_during_refund()
  from public, anon, authenticated;
revoke all on function public.protect_bread_club_order_item_during_refund()
  from public, anon, authenticated;
revoke all on function public.protect_bread_club_addon_during_refund()
  from public, anon, authenticated;
revoke all on function public.begin_bread_club_credit_refund_attempt(uuid)
  from public, anon, authenticated;
revoke all on function public.record_bread_club_credit_refund(uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.record_bread_club_credit_refund_error(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.begin_bread_club_cycle_refund_attempt(uuid)
  from public, anon, authenticated;
revoke all on function public.record_bread_club_cycle_refund(uuid, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.record_bread_club_cycle_refund_error(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.begin_bread_club_cycle_refund(uuid)
  from public, anon, authenticated;
revoke all on function public.refund_bread_club_cycle(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.release_bread_club_cycle(uuid)
  from public, anon, authenticated;
revoke all on function public.activate_bread_club_cycle(uuid, text, text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.begin_bread_club_credit_refund_attempt(uuid)
  to service_role;
grant execute on function public.record_bread_club_credit_refund(uuid, text, text, text, text)
  to service_role;
grant execute on function public.record_bread_club_credit_refund_error(uuid, text, text)
  to service_role;
grant execute on function public.begin_bread_club_cycle_refund_attempt(uuid)
  to service_role;
grant execute on function public.record_bread_club_cycle_refund(uuid, text, text, text, text, text)
  to service_role;
grant execute on function public.record_bread_club_cycle_refund_error(uuid, text, text)
  to service_role;
grant execute on function public.begin_bread_club_cycle_refund(uuid)
  to service_role;
grant execute on function public.refund_bread_club_cycle(uuid, text, text)
  to service_role;
grant execute on function public.release_bread_club_cycle(uuid)
  to service_role;
grant execute on function public.activate_bread_club_cycle(uuid, text, text, timestamptz)
  to service_role;
