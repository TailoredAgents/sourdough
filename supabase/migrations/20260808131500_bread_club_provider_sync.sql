alter table public.bread_club_memberships
  add column if not exists provider_sync_revision bigint not null default 0
    check (provider_sync_revision >= 0),
  add column if not exists provider_sync_required boolean not null default false,
  add column if not exists provider_sync_error text,
  add column if not exists provider_sync_attempted_at timestamptz,
  add column if not exists provider_sync_claim_token uuid,
  add column if not exists provider_sync_claimed_at timestamptz,
  add column if not exists provider_desired_plan_price_id text
    check (
      provider_desired_plan_price_id is null
      or (
        provider_desired_plan_price_id ~ '^price_[A-Za-z0-9_]+$'
        and char_length(provider_desired_plan_price_id) <= 255
      )
    ),
  add column if not exists provider_desired_plan_price_cents integer
    check (
      provider_desired_plan_price_cents is null
      or provider_desired_plan_price_cents between 0 and 1000000
    ),
  add column if not exists provider_desired_delivery_price_id text
    check (
      provider_desired_delivery_price_id is null
      or (
        provider_desired_delivery_price_id ~ '^price_[A-Za-z0-9_]+$'
        and char_length(provider_desired_delivery_price_id) <= 255
      )
    ),
  add column if not exists provider_desired_delivery_price_cents integer
    check (
      provider_desired_delivery_price_cents is null
      or provider_desired_delivery_price_cents between 0 and 1000000
    ),
  add column if not exists provider_desired_delivery_address jsonb
    check (
      provider_desired_delivery_address is null
      or jsonb_typeof(provider_desired_delivery_address) = 'object'
    ),
  add column if not exists provider_desired_customer_name text
    check (
      provider_desired_customer_name is null
      or char_length(provider_desired_customer_name) between 1 and 120
    ),
  add column if not exists provider_desired_customer_phone text
    check (
      provider_desired_customer_phone is null
      or char_length(provider_desired_customer_phone) <= 40
    );

do $migration$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'bread_club_memberships_provider_claim_pair_check'
      and conrelid = 'public.bread_club_memberships'::regclass
  ) then
    alter table public.bread_club_memberships
      add constraint bread_club_memberships_provider_claim_pair_check
      check (
        (provider_sync_claim_token is null) =
          (provider_sync_claimed_at is null)
      );
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'bread_club_memberships_provider_desired_state_check'
      and conrelid = 'public.bread_club_memberships'::regclass
  ) then
    alter table public.bread_club_memberships
      add constraint bread_club_memberships_provider_desired_state_check
      check (
        provider_sync_required = false
        or (
          provider_sync_revision > 0
          and provider_desired_plan_price_id is not null
          and provider_desired_plan_price_cents is not null
          and provider_desired_delivery_price_id is not null
          and provider_desired_delivery_price_cents is not null
          and provider_desired_delivery_address is not null
          and provider_desired_customer_name is not null
          and provider_desired_customer_phone is not null
        )
      );
  end if;
end
$migration$;

create index if not exists bread_club_memberships_provider_sync_idx
  on public.bread_club_memberships(provider_sync_required, updated_at)
  where provider_sync_required = true;

create or replace function public.begin_bread_club_plan_provider_change(
  p_membership_id uuid,
  p_plan_id uuid,
  p_selection jsonb
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  membership_row public.bread_club_memberships%rowtype;
  plan_row public.bread_club_plans%rowtype;
  delivery_price_row public.bread_club_delivery_prices%rowtype;
  customer_name text;
  customer_phone text;
  normalized_selection jsonb;
  next_revision bigint;
begin
  if p_membership_id is null
    or p_plan_id is null
    or p_selection is null
    or jsonb_typeof(p_selection) <> 'array'
    or jsonb_array_length(p_selection) not between 1 and 2
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_selection) selection(item)
      where jsonb_typeof(item) <> 'object'
        or coalesce(item ->> 'product_id', '') !~* (
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        )
        or coalesce(item ->> 'quantity', '') !~ '^[0-9]+$'
        or (item ->> 'quantity')::integer not between 1 and 100
    )
  then
    raise exception 'Bread Club plan change is invalid.';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_selection) selection(item)
    group by (item ->> 'product_id')::uuid
    having count(*) > 1
  ) then
    raise exception 'A Bread Club loaf can appear only once.';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'product_id', (item ->> 'product_id')::uuid,
        'quantity', (item ->> 'quantity')::integer
      )
      order by (item ->> 'product_id')::uuid
    ),
    '[]'::jsonb
  )
  into normalized_selection
  from pg_catalog.jsonb_array_elements(p_selection) selection(item);

  select *
  into membership_row
  from public.bread_club_memberships
  where id = p_membership_id
    and status in ('active', 'past_due')
  for update;

  if membership_row.id is null then
    raise exception 'Active Bread Club membership was not found.';
  end if;
  if membership_row.provider_sync_claim_token is not null
    and membership_row.provider_sync_claimed_at > now() - interval '5 minutes'
  then
    raise exception 'A Bread Club billing update is already synchronizing. Try again shortly.';
  end if;

  select plan.*
  into plan_row
  from public.bread_club_plans plan
  where plan.id = p_plan_id
    and plan.active = true
  for share;
  if plan_row.id is null
    or plan_row.stripe_price_id is null
    or plan_row.stripe_price_id !~ '^price_[A-Za-z0-9_]+$'
    or char_length(plan_row.stripe_price_id) > 255
    or plan_row.stripe_price_cents is distinct from plan_row.price_cents
  then
    raise exception 'The requested Bread Club plan is not provider-ready.';
  end if;
  if (
    select coalesce(sum((item ->> 'quantity')::integer), 0)
    from pg_catalog.jsonb_array_elements(normalized_selection) selection(item)
  ) <> plan_row.loaves_per_week then
    raise exception '% requires % loaf(s) for each Sunday.',
      plan_row.name,
      plan_row.loaves_per_week;
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(normalized_selection) selection(item)
    left join public.bread_club_plan_products eligibility
      on eligibility.plan_id = plan_row.id
      and eligibility.product_id = (item ->> 'product_id')::uuid
      and eligibility.active = true
    left join public.products product
      on product.id = eligibility.product_id
      and product.active = true
      and product.category = 'bread'
    where product.id is null
  ) then
    raise exception 'One selected loaf is not eligible for this Bread Club plan.';
  end if;

  select delivery_price.*
  into delivery_price_row
  from public.bread_club_delivery_prices delivery_price
  where delivery_price.band_key = coalesce(
      membership_row.pending_route_band_key,
      membership_row.route_band_key
    )
    and delivery_price.active = true
  for share;
  if delivery_price_row.id is null
    or delivery_price_row.stripe_price_id is null
    or delivery_price_row.stripe_price_id !~ '^price_[A-Za-z0-9_]+$'
    or char_length(delivery_price_row.stripe_price_id) > 255
    or delivery_price_row.stripe_price_cents is distinct from
      delivery_price_row.price_cents
  then
    raise exception 'The current Bread Club delivery price is not provider-ready.';
  end if;

  select trim(customer.name), coalesce(nullif(trim(customer.phone), ''), '')
  into customer_name, customer_phone
  from public.customers customer
  where customer.id = membership_row.customer_id;
  if customer_name is null then
    raise exception 'The Bread Club customer was not found.';
  end if;
  if exists (
    select 1
    from public.bread_club_cycles cycle
    where cycle.membership_id = membership_row.id
      and cycle.status in ('pending_payment', 'past_due')
  ) then
    raise exception 'The next renewal is already reserved.';
  end if;

  update public.bread_club_memberships
  set pending_plan_id = p_plan_id,
      default_selection = normalized_selection,
      provider_sync_revision = provider_sync_revision + 1,
      provider_sync_required = true,
      provider_sync_error = null,
      provider_sync_claim_token = null,
      provider_sync_claimed_at = null,
      provider_desired_plan_price_id = plan_row.stripe_price_id,
      provider_desired_plan_price_cents = plan_row.price_cents,
      provider_desired_delivery_price_id = delivery_price_row.stripe_price_id,
      provider_desired_delivery_price_cents = delivery_price_row.price_cents,
      provider_desired_delivery_address = membership_row.delivery_address,
      provider_desired_customer_name = customer_name,
      provider_desired_customer_phone = coalesce(
        nullif(trim(membership_row.delivery_address ->> 'phone'), ''),
        customer_phone,
        ''
      ),
      updated_at = now()
  where id = membership_row.id
  returning provider_sync_revision into next_revision;

  return next_revision;
end;
$$;

create or replace function public.begin_bread_club_address_provider_change(
  p_membership_id uuid,
  p_delivery_address jsonb,
  p_delivery_instructions text,
  p_delivery_check jsonb,
  p_route_fee_cents integer,
  p_route_band_key text
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  membership_row public.bread_club_memberships%rowtype;
  plan_row public.bread_club_plans%rowtype;
  delivery_price_row public.bread_club_delivery_prices%rowtype;
  customer_name text;
  customer_email text;
  customer_phone text;
  route_duration_minutes numeric;
  next_revision bigint;
begin
  if p_membership_id is null
    or p_delivery_address is null
    or jsonb_typeof(p_delivery_address) <> 'object'
    or p_delivery_check is null
    or jsonb_typeof(p_delivery_check) <> 'object'
    or p_route_fee_cents is null
    or p_route_fee_cents not between 0 and 250000
    or nullif(trim(p_route_band_key), '') is null
    or char_length(trim(p_route_band_key)) > 100
    or char_length(coalesce(p_delivery_instructions, '')) > 1000
  then
    raise exception 'Bread Club address change is invalid.';
  end if;
  if char_length(trim(coalesce(p_delivery_address ->> 'line1', '')))
      not between 3 and 180
    or char_length(trim(coalesce(p_delivery_address ->> 'line2', ''))) > 120
    or char_length(trim(coalesce(p_delivery_address ->> 'city', '')))
      not between 1 and 100
    or upper(trim(coalesce(p_delivery_address ->> 'state', '')))
      not in ('GA', 'GEORGIA')
    or trim(coalesce(p_delivery_address ->> 'postalCode', '')) !~ '^[0-9]{5}$'
    or coalesce(p_delivery_check ->> 'eligible', 'false') <> 'true'
    or coalesce(p_delivery_check ->> 'preliminary', 'false') <> 'false'
    or coalesce(p_delivery_check ->> 'feeCents', '') !~ '^[0-9]+$'
    or (p_delivery_check ->> 'feeCents')::integer <> p_route_fee_cents
    or coalesce(p_delivery_check ->> 'durationMinutes', '')
      !~ '^[0-9]+(?:\.[0-9]+)?$'
  then
    raise exception 'Bread Club delivery address is invalid.';
  end if;
  route_duration_minutes :=
    (p_delivery_check ->> 'durationMinutes')::numeric;

  select *
  into membership_row
  from public.bread_club_memberships
  where id = p_membership_id
    and status in ('active', 'past_due', 'canceling')
  for update;

  if membership_row.id is null then
    raise exception 'Active Bread Club membership was not found.';
  end if;
  if membership_row.provider_sync_claim_token is not null
    and membership_row.provider_sync_claimed_at > now() - interval '5 minutes'
  then
    raise exception 'A Bread Club billing update is already synchronizing. Try again shortly.';
  end if;

  select
    trim(customer.name),
    lower(trim(customer.email)),
    coalesce(nullif(trim(customer.phone), ''), '')
  into customer_name, customer_email, customer_phone
  from public.customers customer
  where customer.id = membership_row.customer_id;
  if customer_name is null then
    raise exception 'The Bread Club customer was not found.';
  end if;
  if lower(trim(coalesce(p_delivery_address ->> 'email', ''))) <>
      customer_email
    or trim(coalesce(p_delivery_address ->> 'phone', '')) <> customer_phone
  then
    raise exception 'Bread Club delivery contact details are invalid.';
  end if;

  select plan.*
  into plan_row
  from public.bread_club_plans plan
  where plan.id = coalesce(
      membership_row.pending_plan_id,
      membership_row.plan_id
    )
    and plan.active = true
  for share;
  if plan_row.id is null
    or plan_row.stripe_price_id is null
    or plan_row.stripe_price_id !~ '^price_[A-Za-z0-9_]+$'
    or char_length(plan_row.stripe_price_id) > 255
    or plan_row.stripe_price_cents is distinct from plan_row.price_cents
  then
    raise exception 'The current Bread Club plan is not provider-ready.';
  end if;

  select delivery_price.*
  into delivery_price_row
  from public.bread_club_delivery_prices delivery_price
  where delivery_price.band_key = trim(p_route_band_key)
    and delivery_price.active = true
    and delivery_price.price_cents = p_route_fee_cents * 4
    and route_duration_minutes between
      delivery_price.min_minutes and delivery_price.max_minutes
  for share;
  if delivery_price_row.id is null
    or delivery_price_row.stripe_price_id is null
    or delivery_price_row.stripe_price_id !~ '^price_[A-Za-z0-9_]+$'
    or char_length(delivery_price_row.stripe_price_id) > 255
    or delivery_price_row.stripe_price_cents is distinct from
      delivery_price_row.price_cents
  then
    raise exception 'The requested delivery price is not provider-ready.';
  end if;
  if exists (
    select 1
    from public.bread_club_cycles cycle
    where cycle.membership_id = membership_row.id
      and cycle.status in ('pending_payment', 'past_due')
  ) then
    raise exception 'The next renewal is already reserved.';
  end if;

  update public.bread_club_memberships
  set delivery_address = p_delivery_address,
      delivery_instructions = nullif(trim(p_delivery_instructions), ''),
      delivery_check = p_delivery_check,
      pending_route_fee_cents = p_route_fee_cents,
      pending_route_band_key = trim(p_route_band_key),
      provider_sync_revision = provider_sync_revision + 1,
      provider_sync_required = true,
      provider_sync_error = null,
      provider_sync_claim_token = null,
      provider_sync_claimed_at = null,
      provider_desired_plan_price_id = plan_row.stripe_price_id,
      provider_desired_plan_price_cents = plan_row.price_cents,
      provider_desired_delivery_price_id = delivery_price_row.stripe_price_id,
      provider_desired_delivery_price_cents = delivery_price_row.price_cents,
      provider_desired_delivery_address = p_delivery_address,
      provider_desired_customer_name = customer_name,
      provider_desired_customer_phone = customer_phone,
      updated_at = now()
  where id = membership_row.id
  returning provider_sync_revision into next_revision;

  update public.orders bakery_order
  set delivery_address = p_delivery_address,
      delivery_instructions = nullif(trim(p_delivery_instructions), ''),
      delivery_check = p_delivery_check,
      delivery_miles = nullif(
        coalesce(
          p_delivery_check ->> 'distanceMiles',
          p_delivery_check ->> 'miles'
        ),
        ''
      )::numeric,
      updated_at = now()
  from public.bread_club_fulfillments fulfillment
  where fulfillment.membership_id = membership_row.id
    and fulfillment.order_id = bakery_order.id
    and fulfillment.status = 'scheduled'
    and bakery_order.status in ('paid', 'baking');

  return next_revision;
end;
$$;

create or replace function public.claim_bread_club_provider_sync(
  p_membership_id uuid,
  p_expected_revision bigint default null
)
returns table (
  sync_revision bigint,
  sync_claim_token uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  membership_row public.bread_club_memberships%rowtype;
  next_claim_token uuid;
begin
  if p_membership_id is null
    or (p_expected_revision is not null and p_expected_revision <= 0)
  then
    raise exception 'Bread Club provider-sync claim is invalid.';
  end if;

  select *
  into membership_row
  from public.bread_club_memberships
  where id = p_membership_id
  for update;

  if membership_row.id is null then
    raise exception 'Bread Club membership was not found.';
  end if;
  if p_expected_revision is not null
    and membership_row.provider_sync_revision <> p_expected_revision
  then
    return;
  end if;
  if membership_row.provider_sync_required = false then
    return;
  end if;
  if membership_row.provider_sync_claim_token is not null
    and membership_row.provider_sync_claimed_at > now() - interval '5 minutes'
  then
    return;
  end if;

  next_claim_token := gen_random_uuid();
  update public.bread_club_memberships
  set provider_sync_claim_token = next_claim_token,
      provider_sync_claimed_at = now(),
      provider_sync_attempted_at = now(),
      updated_at = now()
  where id = membership_row.id;

  return query
  select membership_row.provider_sync_revision, next_claim_token;
end;
$$;

create or replace function public.finish_bread_club_provider_sync(
  p_membership_id uuid,
  p_revision bigint,
  p_claim_token uuid,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  membership_row public.bread_club_memberships%rowtype;
  normalized_error text := nullif(trim(coalesce(p_error, '')), '');
begin
  if p_membership_id is null
    or p_revision is null
    or p_revision <= 0
    or p_claim_token is null
    or char_length(coalesce(p_error, '')) > 2000
  then
    raise exception 'Bread Club provider-sync result is invalid.';
  end if;

  select *
  into membership_row
  from public.bread_club_memberships
  where id = p_membership_id
  for update;

  if membership_row.id is null then
    raise exception 'Bread Club membership was not found.';
  end if;

  if membership_row.provider_sync_claim_token is distinct from p_claim_token then
    update public.bread_club_memberships
    set provider_sync_required = true,
        provider_sync_error = coalesce(
          provider_sync_error,
          'A superseded provider worker finished; reconciliation is required.'
        ),
        provider_sync_attempted_at = now(),
        updated_at = now()
    where id = membership_row.id;
    return false;
  end if;

  if membership_row.provider_sync_revision <> p_revision then
    update public.bread_club_memberships
    set provider_sync_required = true,
        provider_sync_error =
          'Provider state changed during sync; reconciliation is required.',
        provider_sync_attempted_at = now(),
        provider_sync_claim_token = null,
        provider_sync_claimed_at = null,
        updated_at = now()
    where id = membership_row.id;
    return false;
  end if;

  update public.bread_club_memberships
  set provider_sync_required = normalized_error is not null,
      provider_sync_error = normalized_error,
      provider_sync_attempted_at = now(),
      provider_sync_claim_token = case
        when normalized_error is null then null
        else p_claim_token
      end,
      provider_sync_claimed_at = case
        when normalized_error is null then null
        else now()
      end,
      updated_at = now()
  where id = membership_row.id;

  return true;
end;
$$;

create or replace function public.protect_bread_club_provider_synced_renewal()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  membership_row public.bread_club_memberships%rowtype;
begin
  -- Cycle one is reserved before Stripe Checkout exists, so the enrollment
  -- transaction must remain independent from post-enrollment provider sync.
  if new.cycle_number = 1 then
    return new;
  end if;

  select membership.*
  into membership_row
  from public.bread_club_memberships membership
  where membership.id = new.membership_id
  for update;
  if membership_row.id is null then
    raise exception 'Bread Club membership was not found.';
  end if;
  if membership_row.provider_sync_required then
    raise exception 'Bread Club provider changes must finish before renewal.';
  end if;
  if membership_row.pending_plan_id is not null
    and (
      membership_row.provider_desired_plan_price_id is null
      or membership_row.provider_desired_plan_price_cents is distinct from
        new.plan_price_cents
    )
  then
    raise exception 'Bread Club renewal plan pricing does not match the synchronized provider price.';
  end if;
  if membership_row.pending_route_fee_cents is not null
    and (
      membership_row.provider_desired_delivery_price_id is null
      or membership_row.provider_desired_delivery_price_cents is distinct from
        new.delivery_price_cents
    )
  then
    raise exception 'Bread Club renewal delivery pricing does not match the synchronized provider price.';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_bread_club_provider_synced_renewal
  on public.bread_club_cycles;
create trigger protect_bread_club_provider_synced_renewal
before insert on public.bread_club_cycles
for each row execute function public.protect_bread_club_provider_synced_renewal();

revoke all on function public.begin_bread_club_plan_provider_change(
  uuid,
  uuid,
  jsonb
) from public, anon, authenticated;
revoke all on function public.begin_bread_club_address_provider_change(
  uuid,
  jsonb,
  text,
  jsonb,
  integer,
  text
) from public, anon, authenticated;
revoke all on function public.claim_bread_club_provider_sync(
  uuid,
  bigint
) from public, anon, authenticated;
revoke all on function public.finish_bread_club_provider_sync(
  uuid,
  bigint,
  uuid,
  text
) from public, anon, authenticated;
revoke all on function public.protect_bread_club_provider_synced_renewal()
  from public, anon, authenticated;

grant execute on function public.begin_bread_club_plan_provider_change(
  uuid,
  uuid,
  jsonb
) to service_role;
grant execute on function public.begin_bread_club_address_provider_change(
  uuid,
  jsonb,
  text,
  jsonb,
  integer,
  text
) to service_role;
grant execute on function public.claim_bread_club_provider_sync(
  uuid,
  bigint
) to service_role;
grant execute on function public.finish_bread_club_provider_sync(
  uuid,
  bigint,
  uuid,
  text
) to service_role;
