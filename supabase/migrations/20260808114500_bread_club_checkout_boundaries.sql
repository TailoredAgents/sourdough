alter table public.bread_club_memberships
  add column if not exists checkout_attempt_id uuid,
  add column if not exists checkout_request_hash text,
  add column if not exists checkout_expires_at timestamptz,
  add column if not exists checkout_delivery_price_id uuid
    references public.bread_club_delivery_prices(id),
  add column if not exists checkout_plan_stripe_price_id text,
  add column if not exists checkout_delivery_stripe_price_id text,
  add column if not exists checkout_automatic_tax_enabled boolean
    not null default false;

create unique index if not exists bread_club_memberships_checkout_attempt_unique_idx
  on public.bread_club_memberships(checkout_attempt_id)
  where checkout_attempt_id is not null;

create index if not exists bread_club_memberships_checkout_expiry_idx
  on public.bread_club_memberships(checkout_expires_at)
  where status = 'pending_checkout';

alter table public.bread_club_addon_checkouts
  add column if not exists checkout_attempt_id uuid,
  add column if not exists checkout_request_hash text,
  add column if not exists checkout_cancel_token text,
  add column if not exists checkout_expires_at timestamptz,
  add column if not exists checkout_terminal_reason text,
  add column if not exists checkout_automatic_tax_enabled boolean
    not null default false;

alter table public.bread_club_addon_checkouts
  alter column checkout_cancel_token
    set default pg_catalog.encode(extensions.gen_random_bytes(24), 'hex');

create unique index if not exists bread_club_addon_checkouts_attempt_unique_idx
  on public.bread_club_addon_checkouts(checkout_attempt_id)
  where checkout_attempt_id is not null;

create unique index if not exists bread_club_addon_checkouts_cancel_token_unique_idx
  on public.bread_club_addon_checkouts(checkout_cancel_token)
  where checkout_cancel_token is not null;

create index if not exists bread_club_addon_checkouts_expiry_idx
  on public.bread_club_addon_checkouts(checkout_expires_at)
  where status = 'pending_payment';

do $migration$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.bread_club_memberships'::regclass
      and constraint_record.conname = 'bread_club_memberships_attempt_snapshot_check'
  ) then
    alter table public.bread_club_memberships
      add constraint bread_club_memberships_attempt_snapshot_check
      check (
        checkout_attempt_id is null
        or (
          checkout_request_hash ~ '^[0-9a-f]{64}$'
          and checkout_expires_at is not null
          and checkout_delivery_price_id is not null
          and checkout_plan_stripe_price_id ~ '^price_[A-Za-z0-9_]+$'
          and checkout_delivery_stripe_price_id ~ '^price_[A-Za-z0-9_]+$'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.bread_club_addon_checkouts'::regclass
      and constraint_record.conname = 'bread_club_addon_checkouts_attempt_snapshot_check'
  ) then
    alter table public.bread_club_addon_checkouts
      add constraint bread_club_addon_checkouts_attempt_snapshot_check
      check (
        checkout_attempt_id is null
        or (
          checkout_request_hash ~ '^[0-9a-f]{64}$'
          and checkout_cancel_token ~ '^[0-9a-f]{48}$'
          and checkout_expires_at is not null
        )
      );
  end if;
end
$migration$;

create or replace function public.create_bread_club_subscription_checkout(
  p_checkout_attempt_id uuid,
  p_checkout_request_hash text,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_plan_id uuid,
  p_delivery_price_id uuid,
  p_expected_plan_price_cents integer,
  p_expected_delivery_price_cents integer,
  p_automatic_tax_enabled boolean,
  p_default_selection jsonb,
  p_delivery_address jsonb,
  p_delivery_instructions text,
  p_delivery_check jsonb,
  p_checkout_cancel_token text,
  p_consent_version text,
  p_consent_text text,
  p_consent_ip_hash text,
  p_fulfillments jsonb
)
returns table (
  membership_id uuid,
  cycle_id uuid,
  customer_id uuid,
  checkout_cancel_token text,
  first_delivery_at timestamptz,
  cycle_total_cents integer,
  checkout_expires_at timestamptz,
  checkout_automatic_tax_enabled boolean,
  stripe_checkout_session_id text,
  plan_stripe_price_id text,
  delivery_stripe_price_id text,
  route_band_key text,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_customer_email text := lower(trim(coalesce(p_customer_email, '')));
  v_customer_id uuid;
  v_membership_id uuid;
  v_cycle_id uuid;
  v_plan public.bread_club_plans%rowtype;
  v_delivery_price public.bread_club_delivery_prices%rowtype;
  v_existing_membership public.bread_club_memberships%rowtype;
  v_existing_customer public.customers%rowtype;
  v_existing_cycle public.bread_club_cycles%rowtype;
  v_requested_selection jsonb;
  v_requested_fulfillments jsonb;
  v_existing_fulfillments jsonb;
  v_first_delivery_at timestamptz;
  v_cycle_total_cents integer;
  v_checkout_expires_at timestamptz := now() + interval '1 hour';
  v_delivery_window_count integer;
  v_duration_minutes numeric;
begin
  if p_checkout_attempt_id is null
    or nullif(trim(coalesce(p_checkout_request_hash, '')), '') is null
    or p_checkout_request_hash !~ '^[0-9a-f]{64}$'
    or char_length(trim(coalesce(p_customer_name, ''))) not between 2 and 120
    or char_length(v_customer_email) not between 3 and 320
    or position('@' in v_customer_email) <= 1
    or char_length(coalesce(p_customer_phone, '')) > 40
    or char_length(
      pg_catalog.regexp_replace(coalesce(p_customer_phone, ''), '[^0-9]', '', 'g')
    ) not between 7 and 20
    or p_plan_id is null
    or p_delivery_price_id is null
    or p_expected_plan_price_cents is null
    or p_expected_plan_price_cents not between 0 and 1000000
    or p_expected_delivery_price_cents is null
    or p_expected_delivery_price_cents not between 0 and 1000000
    or p_automatic_tax_enabled is null
    or p_delivery_address is null
    or jsonb_typeof(p_delivery_address) <> 'object'
    or p_delivery_check is null
    or jsonb_typeof(p_delivery_check) <> 'object'
    or char_length(coalesce(p_delivery_instructions, '')) > 1000
    or p_checkout_cancel_token is null
    or p_checkout_cancel_token !~ '^[0-9a-f]{48}$'
    or char_length(trim(coalesce(p_consent_version, ''))) not between 1 and 100
    or char_length(trim(coalesce(p_consent_text, ''))) not between 40 and 1000
    or (
      p_consent_ip_hash is not null
      and p_consent_ip_hash !~ '^[0-9a-f]{64}$'
    )
  then
    raise exception 'Bread Club checkout details are invalid.';
  end if;

  if lower(trim(coalesce(p_delivery_address ->> 'email', ''))) <> v_customer_email
    or trim(coalesce(p_delivery_address ->> 'phone', '')) <> trim(p_customer_phone)
    or char_length(trim(coalesce(p_delivery_address ->> 'line1', ''))) not between 3 and 180
    or char_length(trim(coalesce(p_delivery_address ->> 'line2', ''))) > 120
    or char_length(trim(coalesce(p_delivery_address ->> 'city', ''))) not between 1 and 100
    or upper(trim(coalesce(p_delivery_address ->> 'state', ''))) not in ('GA', 'GEORGIA')
    or trim(coalesce(p_delivery_address ->> 'postalCode', '')) !~ '^[0-9]{5}$'
    or coalesce(p_delivery_check ->> 'eligible', 'false') <> 'true'
    or coalesce(p_delivery_check ->> 'preliminary', 'false') <> 'false'
    or coalesce(p_delivery_check ->> 'feeCents', '') !~ '^[0-9]+$'
  then
    raise exception 'Bread Club delivery details are invalid.';
  end if;

  if p_default_selection is null
    or jsonb_typeof(p_default_selection) <> 'array'
    or jsonb_array_length(p_default_selection) not between 1 and 20
    or exists (
      select 1
      from jsonb_array_elements(p_default_selection) as selections(item)
      where jsonb_typeof(item) <> 'object'
        or coalesce(item ->> 'product_id', '') !~* (
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        )
        or coalesce(item ->> 'quantity', '') !~ '^[0-9]+$'
        or (item ->> 'quantity')::integer not between 1 and 100
    )
  then
    raise exception 'Bread Club loaf selection is invalid.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_default_selection) as selections(item)
    group by (item ->> 'product_id')::uuid
    having count(*) > 1
  ) then
    raise exception 'A Bread Club loaf can appear only once.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'product_id', (item ->> 'product_id')::uuid,
        'quantity', (item ->> 'quantity')::integer
      )
      order by (item ->> 'product_id')::uuid
    ),
    '[]'::jsonb
  )
  into v_requested_selection
  from jsonb_array_elements(p_default_selection) as selections(item);

  if p_fulfillments is null
    or jsonb_typeof(p_fulfillments) <> 'array'
    or jsonb_array_length(p_fulfillments) <> 4
    or exists (
      select 1
      from jsonb_array_elements(p_fulfillments) as fulfillments(item)
      where jsonb_typeof(item) <> 'object'
        or coalesce(item ->> 'weekly_menu_id', '') !~* (
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        )
        or coalesce(item ->> 'delivery_window_id', '') !~* (
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        )
        or jsonb_typeof(item -> 'selection') <> 'array'
        or jsonb_array_length(item -> 'selection') not between 1 and 20
    )
    or exists (
      select 1
      from jsonb_array_elements(p_fulfillments) as fulfillments(fulfillment)
      cross join lateral jsonb_array_elements(fulfillment -> 'selection') as selections(item)
      where jsonb_typeof(item) <> 'object'
        or coalesce(item ->> 'product_id', '') !~* (
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        )
        or coalesce(item ->> 'quantity', '') !~ '^[0-9]+$'
        or (item ->> 'quantity')::integer not between 1 and 100
    )
  then
    raise exception 'Bread Club fulfillment details are invalid.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_fulfillments) as fulfillments(fulfillment)
    cross join lateral jsonb_array_elements(fulfillment -> 'selection') as selections(item)
    group by fulfillment, (item ->> 'product_id')::uuid
    having count(*) > 1
  ) then
    raise exception 'A Bread Club fulfillment loaf can appear only once.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'weekly_menu_id', (fulfillment ->> 'weekly_menu_id')::uuid,
        'delivery_window_id', (fulfillment ->> 'delivery_window_id')::uuid,
        'selection', (
          select jsonb_agg(
            jsonb_build_object(
              'product_id', (selection ->> 'product_id')::uuid,
              'quantity', (selection ->> 'quantity')::integer
            )
            order by (selection ->> 'product_id')::uuid
          )
          from jsonb_array_elements(fulfillment -> 'selection') as selections(selection)
        )
      )
      order by
        (fulfillment ->> 'weekly_menu_id')::uuid,
        (fulfillment ->> 'delivery_window_id')::uuid
    ),
    '[]'::jsonb
  )
  into v_requested_fulfillments
  from jsonb_array_elements(p_fulfillments) as fulfillments(fulfillment);

  if exists (
    select 1
    from jsonb_array_elements(v_requested_fulfillments) as fulfillments(fulfillment)
    where fulfillment -> 'selection' is distinct from v_requested_selection
  ) then
    raise exception 'Each Bread Club Sunday must use the authorized loaf selection.';
  end if;

  if (
    select count(distinct fulfillment ->> 'weekly_menu_id')
    from jsonb_array_elements(v_requested_fulfillments) as fulfillments(fulfillment)
  ) <> 4
    or (
      select count(distinct fulfillment ->> 'delivery_window_id')
      from jsonb_array_elements(v_requested_fulfillments) as fulfillments(fulfillment)
    ) <> 4
  then
    raise exception 'Bread Club checkout requires four distinct Sundays.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'bread-club-subscription-attempt:' || p_checkout_attempt_id::text,
      0
    )
  );

  select membership.*
  into v_existing_membership
  from public.bread_club_memberships membership
  where membership.checkout_attempt_id = p_checkout_attempt_id
  for update;

  if v_existing_membership.id is not null then
    select customer.*
    into v_existing_customer
    from public.customers customer
    where customer.id = v_existing_membership.customer_id;

    select cycle.*
    into v_existing_cycle
    from public.bread_club_cycles cycle
    where cycle.id = v_existing_membership.current_cycle_id
      and cycle.membership_id = v_existing_membership.id;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'weekly_menu_id', fulfillment.weekly_menu_id,
          'delivery_window_id', fulfillment.delivery_window_id,
          'selection', (
            select jsonb_agg(
              jsonb_build_object(
                'product_id', (selection ->> 'product_id')::uuid,
                'quantity', (selection ->> 'quantity')::integer
              )
              order by (selection ->> 'product_id')::uuid
            )
            from jsonb_array_elements(fulfillment.selection) as selections(selection)
          )
        )
        order by fulfillment.weekly_menu_id, fulfillment.delivery_window_id
      ),
      '[]'::jsonb
    )
    into v_existing_fulfillments
    from public.bread_club_fulfillments fulfillment
    where fulfillment.cycle_id = v_existing_membership.current_cycle_id;

    if v_existing_membership.checkout_request_hash is distinct from p_checkout_request_hash
      or v_existing_membership.status <> 'pending_checkout'
      or v_existing_membership.checkout_expires_at is null
      or v_existing_membership.checkout_expires_at <= now()
      or v_existing_membership.plan_id is distinct from p_plan_id
      or v_existing_membership.checkout_delivery_price_id is distinct from p_delivery_price_id
      or v_existing_membership.checkout_automatic_tax_enabled is distinct from p_automatic_tax_enabled
      or v_existing_membership.default_selection is distinct from v_requested_selection
      or v_existing_membership.delivery_address is distinct from p_delivery_address
      or v_existing_membership.delivery_instructions is distinct from nullif(trim(p_delivery_instructions), '')
      or v_existing_membership.delivery_check is distinct from p_delivery_check
      or v_existing_membership.consent_version is distinct from trim(p_consent_version)
      or v_existing_membership.consent_text is distinct from trim(p_consent_text)
      or v_existing_membership.consent_ip_hash is distinct from p_consent_ip_hash
      or lower(v_existing_customer.email) is distinct from v_customer_email
      or v_existing_cycle.id is null
      or v_existing_cycle.plan_price_cents is distinct from p_expected_plan_price_cents
      or v_existing_cycle.delivery_price_cents is distinct from p_expected_delivery_price_cents
      or v_existing_fulfillments is distinct from v_requested_fulfillments
    then
      raise exception 'Bread Club checkout attempt was already used with different or expired details.';
    end if;

    return query
    select
      v_existing_membership.id,
      v_existing_cycle.id,
      v_existing_membership.customer_id,
      v_existing_membership.checkout_cancel_token,
      v_existing_membership.first_delivery_at,
      v_existing_cycle.total_cents,
      v_existing_membership.checkout_expires_at,
      v_existing_membership.checkout_automatic_tax_enabled,
      v_existing_membership.stripe_checkout_session_id,
      v_existing_membership.checkout_plan_stripe_price_id,
      v_existing_membership.checkout_delivery_stripe_price_id,
      v_existing_membership.route_band_key,
      true;
    return;
  end if;

  select plan.*
  into v_plan
  from public.bread_club_plans plan
  where plan.id = p_plan_id
    and plan.active = true
  for share;
  if v_plan.id is null
    or v_plan.price_cents <> p_expected_plan_price_cents
    or v_plan.stripe_price_id is null
    or v_plan.stripe_price_id !~ '^price_[A-Za-z0-9_]+$'
    or char_length(v_plan.stripe_price_id) > 255
    or v_plan.stripe_price_cents is distinct from v_plan.price_cents
  then
    raise exception 'Bread Club plan pricing changed. Refresh and try again.';
  end if;

  if (
    select coalesce(sum((item ->> 'quantity')::integer), 0)
    from jsonb_array_elements(v_requested_selection) as selections(item)
  ) <> v_plan.loaves_per_week
  then
    raise exception 'Bread Club loaf quantity does not match the selected plan.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_requested_selection) as selections(item)
    left join public.bread_club_plan_products eligibility
      on eligibility.plan_id = v_plan.id
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
  into v_delivery_price
  from public.bread_club_delivery_prices delivery_price
  where delivery_price.id = p_delivery_price_id
    and delivery_price.active = true
  for share;
  if v_delivery_price.id is null
    or v_delivery_price.price_cents <> p_expected_delivery_price_cents
    or v_delivery_price.price_cents % 4 <> 0
    or v_delivery_price.stripe_price_id is null
    or v_delivery_price.stripe_price_id !~ '^price_[A-Za-z0-9_]+$'
    or char_length(v_delivery_price.stripe_price_id) > 255
    or v_delivery_price.stripe_price_cents is distinct from v_delivery_price.price_cents
    or (p_delivery_check ->> 'feeCents')::integer * 4 <> v_delivery_price.price_cents
  then
    raise exception 'Bread Club delivery pricing changed. Refresh and try again.';
  end if;

  if nullif(p_delivery_check ->> 'durationMinutes', '') is not null then
    if (p_delivery_check ->> 'durationMinutes') !~ '^[0-9]+(?:\.[0-9]+)?$' then
      raise exception 'Bread Club route duration is invalid.';
    end if;
    v_duration_minutes := (p_delivery_check ->> 'durationMinutes')::numeric;
    if v_duration_minutes < v_delivery_price.min_minutes
      or v_duration_minutes > v_delivery_price.max_minutes
    then
      raise exception 'Bread Club delivery band changed. Refresh and try again.';
    end if;
  end if;

  select min(delivery_window.starts_at), count(*)::integer
  into v_first_delivery_at, v_delivery_window_count
  from jsonb_array_elements(v_requested_fulfillments) as fulfillments(fulfillment)
  join public.delivery_windows delivery_window
    on delivery_window.id = (fulfillment ->> 'delivery_window_id')::uuid
    and delivery_window.weekly_menu_id = (fulfillment ->> 'weekly_menu_id')::uuid;
  if v_delivery_window_count <> 4 or v_first_delivery_at is null then
    raise exception 'One Bread Club Sunday delivery window is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bread-club-customer:' || v_customer_email, 0)
  );
  select customer.id
  into v_customer_id
  from public.customers customer
  where lower(customer.email) = v_customer_email
  order by customer.created_at desc
  limit 1
  for update;

  if v_customer_id is null then
    insert into public.customers (name, email, phone)
    values (
      trim(p_customer_name),
      v_customer_email,
      nullif(trim(p_customer_phone), '')
    )
    returning id into v_customer_id;
  else
    update public.customers customer
    set name = trim(p_customer_name),
        phone = nullif(trim(p_customer_phone), '')
    where customer.id = v_customer_id;
  end if;

  v_cycle_total_cents := v_plan.price_cents + v_delivery_price.price_cents;

  insert into public.bread_club_memberships (
    customer_id,
    plan_id,
    status,
    default_selection,
    delivery_address,
    delivery_instructions,
    delivery_check,
    route_fee_cents,
    route_band_key,
    checkout_cancel_token,
    first_delivery_at,
    consent_version,
    consent_text,
    consented_at,
    consent_ip_hash,
    checkout_attempt_id,
    checkout_request_hash,
    checkout_expires_at,
    checkout_delivery_price_id,
    checkout_plan_stripe_price_id,
    checkout_delivery_stripe_price_id,
    checkout_automatic_tax_enabled
  )
  values (
    v_customer_id,
    v_plan.id,
    'pending_checkout',
    v_requested_selection,
    p_delivery_address,
    nullif(trim(p_delivery_instructions), ''),
    p_delivery_check,
    v_delivery_price.price_cents / 4,
    v_delivery_price.band_key,
    p_checkout_cancel_token,
    v_first_delivery_at,
    trim(p_consent_version),
    trim(p_consent_text),
    now(),
    p_consent_ip_hash,
    p_checkout_attempt_id,
    p_checkout_request_hash,
    v_checkout_expires_at,
    v_delivery_price.id,
    v_plan.stripe_price_id,
    v_delivery_price.stripe_price_id,
    p_automatic_tax_enabled
  )
  returning id into v_membership_id;

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
    v_membership_id,
    1,
    'pending_payment',
    now(),
    now() + interval '28 days',
    v_plan.price_cents,
    v_delivery_price.price_cents,
    0,
    v_cycle_total_cents
  )
  returning id into v_cycle_id;

  perform public.reserve_bread_club_cycle(
    v_membership_id,
    v_cycle_id,
    v_requested_fulfillments
  );

  return query
  select
    v_membership_id,
    v_cycle_id,
    v_customer_id,
    p_checkout_cancel_token,
    v_first_delivery_at,
    v_cycle_total_cents,
    v_checkout_expires_at,
    p_automatic_tax_enabled,
    null::text,
    v_plan.stripe_price_id,
    v_delivery_price.stripe_price_id,
    v_delivery_price.band_key,
    false;
end;
$$;

create or replace function public.attach_bread_club_subscription_checkout(
  p_membership_id uuid,
  p_session_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_existing_session_id text;
  v_status text;
  v_stripe_subscription_id text;
begin
  if p_membership_id is null
    or p_session_id is null
    or p_session_id !~ '^cs_[A-Za-z0-9_]+$'
    or char_length(p_session_id) > 255
  then
    raise exception 'Bread Club Stripe Checkout attachment is invalid.';
  end if;

  select
    membership.stripe_checkout_session_id,
    membership.status,
    membership.stripe_subscription_id
  into v_existing_session_id, v_status, v_stripe_subscription_id
  from public.bread_club_memberships membership
  where membership.id = p_membership_id
  for update;
  if not found then
    return false;
  end if;

  if v_existing_session_id is not null then
    if v_existing_session_id <> p_session_id then
      raise exception 'This Bread Club membership is attached to a different Stripe Checkout Session.';
    end if;
    return true;
  end if;
  if v_status not in ('pending_checkout', 'active', 'past_due')
    or v_stripe_subscription_id is not null
  then
    return false;
  end if;

  update public.bread_club_memberships membership
  set stripe_checkout_session_id = p_session_id,
      updated_at = now()
  where membership.id = p_membership_id
    and membership.stripe_checkout_session_id is null
    and membership.status in ('pending_checkout', 'active', 'past_due')
    and membership.stripe_subscription_id is null;
  return found;
end;
$$;

create or replace function public.record_bread_club_subscription_checkout_completed(
  p_membership_id uuid,
  p_session_id text,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_plan_subscription_item_id text default null,
  p_delivery_subscription_item_id text default null,
  p_current_period_end timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_membership public.bread_club_memberships%rowtype;
begin
  if p_membership_id is null
    or p_session_id is null
    or p_session_id !~ '^cs_[A-Za-z0-9_]+$'
    or char_length(p_session_id) > 255
    or p_stripe_customer_id is null
    or p_stripe_customer_id !~ '^cus_[A-Za-z0-9_]+$'
    or char_length(p_stripe_customer_id) > 255
    or p_stripe_subscription_id is null
    or p_stripe_subscription_id !~ '^sub_[A-Za-z0-9_]+$'
    or char_length(p_stripe_subscription_id) > 255
    or (
      p_plan_subscription_item_id is not null
      and (
        p_plan_subscription_item_id !~ '^si_[A-Za-z0-9_]+$'
        or char_length(p_plan_subscription_item_id) > 255
      )
    )
    or (
      p_delivery_subscription_item_id is not null
      and (
        p_delivery_subscription_item_id !~ '^si_[A-Za-z0-9_]+$'
        or char_length(p_delivery_subscription_item_id) > 255
      )
    )
  then
    raise exception 'Completed Bread Club Stripe Checkout details are invalid.';
  end if;

  select membership.*
  into v_membership
  from public.bread_club_memberships membership
  where membership.id = p_membership_id
  for update;
  if v_membership.id is null then
    return false;
  end if;
  if v_membership.stripe_checkout_session_id is distinct from p_session_id then
    return false;
  end if;
  if v_membership.status not in ('pending_checkout', 'active', 'past_due') then
    return false;
  end if;
  if v_membership.stripe_customer_id is not null
    and v_membership.stripe_customer_id <> p_stripe_customer_id
  then
    raise exception 'This membership is connected to a different Stripe customer.';
  end if;
  if v_membership.stripe_subscription_id is not null
    and v_membership.stripe_subscription_id <> p_stripe_subscription_id
  then
    raise exception 'This membership is connected to a different Stripe subscription.';
  end if;
  if v_membership.stripe_plan_subscription_item_id is not null
    and p_plan_subscription_item_id is not null
    and v_membership.stripe_plan_subscription_item_id <> p_plan_subscription_item_id
  then
    raise exception 'The Bread Club plan subscription item changed unexpectedly.';
  end if;
  if v_membership.stripe_delivery_subscription_item_id is not null
    and p_delivery_subscription_item_id is not null
    and v_membership.stripe_delivery_subscription_item_id <> p_delivery_subscription_item_id
  then
    raise exception 'The Bread Club delivery subscription item changed unexpectedly.';
  end if;

  update public.bread_club_memberships membership
  set stripe_customer_id = coalesce(membership.stripe_customer_id, p_stripe_customer_id),
      stripe_subscription_id = coalesce(
        membership.stripe_subscription_id,
        p_stripe_subscription_id
      ),
      stripe_plan_subscription_item_id = coalesce(
        membership.stripe_plan_subscription_item_id,
        p_plan_subscription_item_id
      ),
      stripe_delivery_subscription_item_id = coalesce(
        membership.stripe_delivery_subscription_item_id,
        p_delivery_subscription_item_id
      ),
      stripe_current_period_end = coalesce(
        membership.stripe_current_period_end,
        p_current_period_end
      ),
      updated_at = now()
  where membership.id = p_membership_id;
  return true;
end;
$$;

create or replace function public.cancel_bread_club_subscription_checkout(
  p_membership_id uuid,
  p_session_id text,
  p_reason text,
  p_checkout_cancel_token text default null,
  p_cycle_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_membership public.bread_club_memberships%rowtype;
begin
  if p_membership_id is null
    or (
      p_session_id is not null
      and (
        p_session_id !~ '^cs_[A-Za-z0-9_]+$'
        or char_length(p_session_id) > 255
      )
    )
    or char_length(trim(coalesce(p_reason, ''))) not between 1 and 500
    or (
      p_checkout_cancel_token is not null
      and p_checkout_cancel_token !~ '^[0-9a-f]{48}$'
    )
  then
    raise exception 'Bread Club checkout cancellation details are invalid.';
  end if;

  select membership.*
  into v_membership
  from public.bread_club_memberships membership
  where membership.id = p_membership_id
  for update;
  if v_membership.id is null then
    return false;
  end if;

  if p_session_id is null then
    if v_membership.stripe_checkout_session_id is not null then
      return false;
    end if;
    if (
      v_membership.checkout_expires_at is not null
      and v_membership.checkout_expires_at > now()
    ) or (
      v_membership.checkout_expires_at is null
      and v_membership.created_at > now() - interval '26 hours'
    )
    then
      return false;
    end if;
  elsif v_membership.stripe_checkout_session_id is distinct from p_session_id then
    return false;
  end if;
  if p_checkout_cancel_token is not null
    and v_membership.checkout_cancel_token is distinct from p_checkout_cancel_token
  then
    return false;
  end if;
  if p_cycle_id is not null
    and v_membership.current_cycle_id is distinct from p_cycle_id
  then
    return false;
  end if;

  if v_membership.status = 'incomplete' then
    return v_membership.stripe_subscription_id is null;
  end if;
  if v_membership.status <> 'pending_checkout'
    or v_membership.stripe_subscription_id is not null
  then
    return false;
  end if;

  if v_membership.current_cycle_id is not null then
    perform public.release_bread_club_cycle(v_membership.current_cycle_id);
  end if;

  update public.bread_club_memberships membership
  set status = 'incomplete',
      cancellation_reason = trim(p_reason),
      updated_at = now()
  where membership.id = p_membership_id
    and membership.status = 'pending_checkout'
    and membership.stripe_subscription_id is null;
  return found;
end;
$$;

create or replace function public.create_bread_club_addon_checkout(
  p_checkout_attempt_id uuid,
  p_checkout_request_hash text,
  p_membership_id uuid,
  p_fulfillment_id uuid,
  p_items jsonb,
  p_subtotal_cents integer,
  p_automatic_tax_enabled boolean,
  p_checkout_cancel_token text
)
returns table (
  addon_checkout_id uuid,
  membership_id uuid,
  fulfillment_id uuid,
  items jsonb,
  subtotal_cents integer,
  checkout_cancel_token text,
  checkout_expires_at timestamptz,
  checkout_automatic_tax_enabled boolean,
  stripe_checkout_session_id text,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_existing_addon public.bread_club_addon_checkouts%rowtype;
  v_fulfillment public.bread_club_fulfillments%rowtype;
  v_membership_status text;
  v_menu_cutoff timestamptz;
  v_requested_items jsonb;
  v_existing_items jsonb;
  v_persisted_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_product_name text;
  v_product_price_cents integer;
  v_product_stripe_price_id text;
  v_product_stripe_price_cents integer;
  v_calculated_subtotal bigint := 0;
  v_addon_id uuid;
  v_checkout_expires_at timestamptz := now() + interval '1 hour';
begin
  if p_checkout_attempt_id is null
    or p_checkout_request_hash is null
    or p_checkout_request_hash !~ '^[0-9a-f]{64}$'
    or p_membership_id is null
    or p_fulfillment_id is null
    or p_subtotal_cents is null
    or p_subtotal_cents not between 0 and 1000000
    or p_automatic_tax_enabled is null
    or p_checkout_cancel_token is null
    or p_checkout_cancel_token !~ '^[0-9a-f]{48}$'
    or p_items is null
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) not between 1 and 50
    or exists (
      select 1
      from jsonb_array_elements(p_items) as checkout_items(item)
      where jsonb_typeof(item) <> 'object'
        or coalesce(item ->> 'product_id', '') !~* (
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        )
        or coalesce(item ->> 'quantity', '') !~ '^[0-9]+$'
        or (item ->> 'quantity')::integer not between 1 and 100
        or coalesce(item ->> 'unit_price_cents', '') !~ '^[0-9]+$'
        or (item ->> 'unit_price_cents')::integer not between 0 and 50000
        or coalesce(item ->> 'stripe_price_id', '') !~ '^price_[A-Za-z0-9_]+$'
        or char_length(item ->> 'stripe_price_id') > 255
        or char_length(trim(coalesce(item ->> 'name', ''))) not between 1 and 200
    )
  then
    raise exception 'Bread Club add-on checkout details are invalid.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as checkout_items(item)
    group by (item ->> 'product_id')::uuid
    having count(*) > 1
  ) then
    raise exception 'A Bread Club add-on can appear only once.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'product_id', (item ->> 'product_id')::uuid,
        'quantity', (item ->> 'quantity')::integer,
        'unit_price_cents', (item ->> 'unit_price_cents')::integer,
        'stripe_price_id', item ->> 'stripe_price_id'
      )
      order by (item ->> 'product_id')::uuid
    ),
    '[]'::jsonb
  )
  into v_requested_items
  from jsonb_array_elements(p_items) as checkout_items(item);

  select coalesce(
    sum(
      (item ->> 'quantity')::bigint
      * (item ->> 'unit_price_cents')::bigint
    ),
    0
  )
  into v_calculated_subtotal
  from jsonb_array_elements(v_requested_items) as checkout_items(item);
  if v_calculated_subtotal <> p_subtotal_cents
    or v_calculated_subtotal > 1000000
  then
    raise exception 'Bread Club add-on subtotal is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'bread-club-addon-attempt:' || p_checkout_attempt_id::text,
      0
    )
  );
  select addon.*
  into v_existing_addon
  from public.bread_club_addon_checkouts addon
  where addon.checkout_attempt_id = p_checkout_attempt_id
  for update;

  if v_existing_addon.id is not null then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'product_id', (item ->> 'product_id')::uuid,
          'quantity', (item ->> 'quantity')::integer,
          'unit_price_cents', (item ->> 'unit_price_cents')::integer,
          'stripe_price_id', item ->> 'stripe_price_id'
        )
        order by (item ->> 'product_id')::uuid
      ),
      '[]'::jsonb
    )
    into v_existing_items
    from jsonb_array_elements(v_existing_addon.items) as checkout_items(item);

    if v_existing_addon.checkout_request_hash is distinct from p_checkout_request_hash
      or v_existing_addon.status <> 'pending_payment'
      or v_existing_addon.checkout_expires_at is null
      or v_existing_addon.checkout_expires_at <= now()
      or v_existing_addon.membership_id is distinct from p_membership_id
      or v_existing_addon.fulfillment_id is distinct from p_fulfillment_id
      or v_existing_addon.subtotal_cents is distinct from p_subtotal_cents
      or v_existing_addon.checkout_automatic_tax_enabled is distinct from p_automatic_tax_enabled
      or v_existing_items is distinct from v_requested_items
    then
      raise exception 'Bread Club add-on attempt was already used with different or expired details.';
    end if;

    return query
    select
      v_existing_addon.id,
      v_existing_addon.membership_id,
      v_existing_addon.fulfillment_id,
      v_existing_addon.items,
      v_existing_addon.subtotal_cents,
      v_existing_addon.checkout_cancel_token,
      v_existing_addon.checkout_expires_at,
      v_existing_addon.checkout_automatic_tax_enabled,
      v_existing_addon.stripe_checkout_session_id,
      true;
    return;
  end if;

  select membership.status
  into v_membership_status
  from public.bread_club_memberships membership
  where membership.id = p_membership_id
    and membership.status in ('active', 'canceling')
  for share;
  if v_membership_status is null then
    raise exception 'Bread Club membership is not eligible for add-ons.';
  end if;

  select fulfillment.*
  into v_fulfillment
  from public.bread_club_fulfillments fulfillment
  where fulfillment.id = p_fulfillment_id
    and fulfillment.membership_id = p_membership_id
    and fulfillment.status = 'scheduled'
  for update;
  if v_fulfillment.id is null then
    raise exception 'Choose an active Bread Club Sunday for add-ons.';
  end if;

  select weekly_menu.order_cutoff_at
  into v_menu_cutoff
  from public.weekly_menus weekly_menu
  where weekly_menu.id = v_fulfillment.weekly_menu_id
    and weekly_menu.published = true
  for share;
  if v_menu_cutoff is null or v_menu_cutoff <= now() then
    raise exception 'The Bread Club add-on cutoff has passed.';
  end if;

  for v_item in
    select item
    from jsonb_array_elements(v_requested_items) as checkout_items(item)
    order by (item ->> 'product_id')::uuid
  loop
    select
      product.name,
      product.price_cents,
      product.stripe_price_id,
      product.stripe_price_cents
    into
      v_product_name,
      v_product_price_cents,
      v_product_stripe_price_id,
      v_product_stripe_price_cents
    from public.products product
    join public.weekly_menu_items menu_item
      on menu_item.product_id = product.id
      and menu_item.weekly_menu_id = v_fulfillment.weekly_menu_id
    where product.id = (v_item ->> 'product_id')::uuid
      and product.active = true
      and product.category = 'add-on'
      and menu_item.unavailable = false
    for share of product
    for update of menu_item;

    if v_product_name is null
      or v_product_price_cents <> (v_item ->> 'unit_price_cents')::integer
      or v_product_stripe_price_id is distinct from (v_item ->> 'stripe_price_id')
      or v_product_stripe_price_cents is distinct from v_product_price_cents
    then
      raise exception 'One Bread Club add-on changed. Refresh and try again.';
    end if;

    v_persisted_items := v_persisted_items || jsonb_build_array(
      jsonb_build_object(
        'product_id', (v_item ->> 'product_id')::uuid,
        'quantity', (v_item ->> 'quantity')::integer,
        'unit_price_cents', v_product_price_cents,
        'stripe_price_id', v_product_stripe_price_id,
        'name', v_product_name
      )
    );
  end loop;

  insert into public.bread_club_addon_checkouts (
    membership_id,
    fulfillment_id,
    items,
    subtotal_cents,
    tax_cents,
    total_cents,
    status,
    checkout_attempt_id,
    checkout_request_hash,
    checkout_cancel_token,
    checkout_expires_at,
    checkout_automatic_tax_enabled
  )
  values (
    p_membership_id,
    p_fulfillment_id,
    v_persisted_items,
    p_subtotal_cents,
    0,
    p_subtotal_cents,
    'pending_payment',
    p_checkout_attempt_id,
    p_checkout_request_hash,
    p_checkout_cancel_token,
    v_checkout_expires_at,
    p_automatic_tax_enabled
  )
  returning id into v_addon_id;

  perform public.reserve_bread_club_addon_inventory(v_addon_id);

  return query
  select
    v_addon_id,
    p_membership_id,
    p_fulfillment_id,
    v_persisted_items,
    p_subtotal_cents,
    p_checkout_cancel_token,
    v_checkout_expires_at,
    p_automatic_tax_enabled,
    null::text,
    false;
end;
$$;

create or replace function public.attach_bread_club_addon_checkout(
  p_addon_checkout_id uuid,
  p_session_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_existing_session_id text;
  v_status text;
begin
  if p_addon_checkout_id is null
    or p_session_id is null
    or p_session_id !~ '^cs_[A-Za-z0-9_]+$'
    or char_length(p_session_id) > 255
  then
    raise exception 'Bread Club add-on Stripe Checkout attachment is invalid.';
  end if;

  select addon.stripe_checkout_session_id, addon.status
  into v_existing_session_id, v_status
  from public.bread_club_addon_checkouts addon
  where addon.id = p_addon_checkout_id
  for update;
  if not found then
    return false;
  end if;
  if v_existing_session_id is not null then
    if v_existing_session_id <> p_session_id then
      raise exception 'This add-on checkout is attached to a different Stripe Checkout Session.';
    end if;
    return true;
  end if;
  if v_status <> 'pending_payment' then
    return false;
  end if;

  update public.bread_club_addon_checkouts addon
  set stripe_checkout_session_id = p_session_id,
      updated_at = now()
  where addon.id = p_addon_checkout_id
    and addon.stripe_checkout_session_id is null
    and addon.status = 'pending_payment';
  return found;
end;
$$;

create or replace function public.complete_bread_club_addon_checkout_fenced(
  p_addon_checkout_id uuid,
  p_session_id text,
  p_payment_intent_id text default null,
  p_tax_cents integer default 0,
  p_total_cents integer default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_addon public.bread_club_addon_checkouts%rowtype;
begin
  if p_addon_checkout_id is null
    or p_session_id is null
    or p_session_id !~ '^cs_[A-Za-z0-9_]+$'
    or char_length(p_session_id) > 255
    or (
      p_payment_intent_id is not null
      and (
        p_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$'
        or char_length(p_payment_intent_id) > 255
      )
    )
    or p_tax_cents is null
    or p_tax_cents not between 0 and 1000000
    or (
      p_total_cents is not null
      and p_total_cents not between 0 and 1000000
    )
  then
    raise exception 'Completed Bread Club add-on details are invalid.';
  end if;

  select addon.*
  into v_addon
  from public.bread_club_addon_checkouts addon
  where addon.id = p_addon_checkout_id
  for update;
  if v_addon.id is null then
    return false;
  end if;
  if v_addon.stripe_checkout_session_id is distinct from p_session_id then
    return false;
  end if;

  if v_addon.status = 'paid' then
    if p_payment_intent_id is not null
      and v_addon.stripe_payment_intent_id is distinct from p_payment_intent_id
    then
      raise exception 'The Bread Club add-on payment intent changed unexpectedly.';
    end if;
    if p_total_cents is not null
      and (
        v_addon.tax_cents is distinct from p_tax_cents
        or v_addon.total_cents is distinct from p_total_cents
      )
    then
      raise exception 'The Bread Club add-on charged total changed unexpectedly.';
    end if;
    return true;
  end if;
  if v_addon.status <> 'pending_payment'
    or v_addon.stripe_payment_intent_id is not null
  then
    return false;
  end if;

  perform public.complete_bread_club_addon_checkout(
    p_addon_checkout_id,
    p_payment_intent_id,
    p_tax_cents,
    p_total_cents
  );

  return exists (
    select 1
    from public.bread_club_addon_checkouts addon
    where addon.id = p_addon_checkout_id
      and addon.status = 'paid'
      and addon.stripe_checkout_session_id = p_session_id
  );
end;
$$;

create or replace function public.cancel_bread_club_addon_checkout(
  p_addon_checkout_id uuid,
  p_session_id text,
  p_reason text default 'expired',
  p_checkout_cancel_token text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_addon public.bread_club_addon_checkouts%rowtype;
  v_terminal_status text;
begin
  if p_addon_checkout_id is null
    or (
      p_session_id is not null
      and (
        p_session_id !~ '^cs_[A-Za-z0-9_]+$'
        or char_length(p_session_id) > 255
      )
    )
    or char_length(trim(coalesce(p_reason, ''))) not between 1 and 500
    or (
      p_checkout_cancel_token is not null
      and p_checkout_cancel_token !~ '^[0-9a-f]{48}$'
    )
  then
    raise exception 'Bread Club add-on cancellation details are invalid.';
  end if;

  select addon.*
  into v_addon
  from public.bread_club_addon_checkouts addon
  where addon.id = p_addon_checkout_id
  for update;
  if v_addon.id is null then
    return false;
  end if;

  if p_session_id is null then
    if v_addon.stripe_checkout_session_id is not null then
      return false;
    end if;
    if (
      v_addon.checkout_expires_at is not null
      and v_addon.checkout_expires_at > now()
    ) or (
      v_addon.checkout_expires_at is null
      and v_addon.created_at > now() - interval '26 hours'
    )
    then
      return false;
    end if;
  elsif v_addon.stripe_checkout_session_id is distinct from p_session_id then
    return false;
  end if;
  if p_checkout_cancel_token is not null
    and v_addon.checkout_cancel_token is distinct from p_checkout_cancel_token
  then
    return false;
  end if;

  if v_addon.status in ('expired', 'canceled') then
    return v_addon.stripe_payment_intent_id is null;
  end if;
  if v_addon.status <> 'pending_payment'
    or v_addon.stripe_payment_intent_id is not null
  then
    return false;
  end if;

  perform public.release_bread_club_addon_inventory(p_addon_checkout_id);
  v_terminal_status := case
    when lower(trim(p_reason)) in ('canceled', 'cancelled', 'browser_cancel')
      then 'canceled'
    else 'expired'
  end;

  update public.bread_club_addon_checkouts addon
  set status = v_terminal_status,
      checkout_terminal_reason = trim(p_reason),
      updated_at = now()
  where addon.id = p_addon_checkout_id
    and addon.status = 'expired'
    and addon.stripe_payment_intent_id is null;
  return found;
end;
$$;

revoke all on function public.create_bread_club_subscription_checkout(
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  uuid,
  integer,
  integer,
  boolean,
  jsonb,
  jsonb,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  jsonb
) from public, anon, authenticated;
revoke all on function public.attach_bread_club_subscription_checkout(uuid, text)
  from public, anon, authenticated;
revoke all on function public.record_bread_club_subscription_checkout_completed(
  uuid,
  text,
  text,
  text,
  text,
  text,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.cancel_bread_club_subscription_checkout(
  uuid,
  text,
  text,
  text,
  uuid
) from public, anon, authenticated;
revoke all on function public.create_bread_club_addon_checkout(
  uuid,
  text,
  uuid,
  uuid,
  jsonb,
  integer,
  boolean,
  text
) from public, anon, authenticated;
revoke all on function public.attach_bread_club_addon_checkout(uuid, text)
  from public, anon, authenticated;
revoke all on function public.complete_bread_club_addon_checkout_fenced(
  uuid,
  text,
  text,
  integer,
  integer
) from public, anon, authenticated;
revoke all on function public.cancel_bread_club_addon_checkout(
  uuid,
  text,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.create_bread_club_subscription_checkout(
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  uuid,
  integer,
  integer,
  boolean,
  jsonb,
  jsonb,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  jsonb
) to service_role;
grant execute on function public.attach_bread_club_subscription_checkout(uuid, text)
  to service_role;
grant execute on function public.record_bread_club_subscription_checkout_completed(
  uuid,
  text,
  text,
  text,
  text,
  text,
  timestamptz
) to service_role;
grant execute on function public.cancel_bread_club_subscription_checkout(
  uuid,
  text,
  text,
  text,
  uuid
) to service_role;
grant execute on function public.create_bread_club_addon_checkout(
  uuid,
  text,
  uuid,
  uuid,
  jsonb,
  integer,
  boolean,
  text
) to service_role;
grant execute on function public.attach_bread_club_addon_checkout(uuid, text)
  to service_role;
grant execute on function public.complete_bread_club_addon_checkout_fenced(
  uuid,
  text,
  text,
  integer,
  integer
) to service_role;
grant execute on function public.cancel_bread_club_addon_checkout(
  uuid,
  text,
  text,
  text
) to service_role;
