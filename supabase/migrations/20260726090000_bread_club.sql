alter table products
  add column if not exists estimated_ingredient_cost_cents integer
  check (
    estimated_ingredient_cost_cents is null
    or estimated_ingredient_cost_cents >= 0
  );

create table if not exists bread_club_settings (
  id boolean primary key default true,
  max_weekly_loaf_slots integer not null default 10
    check (max_weekly_loaf_slots > 0),
  skip_limit_per_cycle integer not null default 1
    check (skip_limit_per_cycle >= 0),
  rollover_credit_days integer not null default 60
    check (rollover_credit_days > 0),
  tax_status text not null default 'pending'
    check (tax_status in ('pending', 'registered', 'exempt')),
  consent_version text not null default '2026-07-26',
  stripe_delivery_product_id text,
  stripe_portal_configuration_id text,
  stripe_webhook_endpoint_id text,
  updated_at timestamptz not null default now(),
  check (id)
);

insert into bread_club_settings (id)
values (true)
on conflict (id) do nothing;

create table if not exists bread_club_plans (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null,
  price_cents integer not null check (price_cents >= 0),
  loaves_per_week integer not null check (loaves_per_week > 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  stripe_product_id text,
  stripe_price_id text,
  stripe_price_cents integer
    check (stripe_price_cents is null or stripe_price_cents >= 0),
  stripe_lookup_key text unique,
  stripe_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into bread_club_plans (
  id,
  slug,
  name,
  description,
  price_cents,
  loaves_per_week,
  sort_order,
  stripe_lookup_key
)
values
  (
    '10000000-0000-4000-8000-000000000001',
    'classic',
    'Classic Club',
    'One dependable sourdough loaf every Sunday for four weeks.',
    4400,
    1,
    10,
    'bread_club_classic_4week_v1'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'variety',
    'Variety Club',
    'Choose one available bread each Sunday for four weeks.',
    5200,
    1,
    20,
    'bread_club_variety_4week_v1'
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    'family',
    'Family Club',
    'Choose any two available breads each Sunday for four weeks.',
    9600,
    2,
    30,
    'bread_club_family_4week_v1'
  )
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  price_cents = excluded.price_cents,
  loaves_per_week = excluded.loaves_per_week,
  sort_order = excluded.sort_order,
  stripe_lookup_key = excluded.stripe_lookup_key,
  updated_at = now();

create table if not exists bread_club_plan_products (
  plan_id uuid not null references bread_club_plans(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  active boolean not null default true,
  guaranteed boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (plan_id, product_id)
);

insert into bread_club_plan_products (plan_id, product_id, active, guaranteed)
select plan.id, product.id, true, product.slug = 'classic-country'
from bread_club_plans plan
join products product
  on product.category = 'bread'
where
  (
    plan.slug = 'classic'
    and product.slug in ('classic-country', 'sourdough-loaf')
  )
  or plan.slug in ('variety', 'family')
on conflict (plan_id, product_id) do update set
  active = excluded.active,
  guaranteed = excluded.guaranteed;

create table if not exists bread_club_delivery_prices (
  id uuid primary key default gen_random_uuid(),
  band_key text not null unique,
  label text not null,
  min_minutes integer not null check (min_minutes >= 0),
  max_minutes integer not null check (max_minutes >= min_minutes),
  price_cents integer not null check (price_cents >= 0),
  active boolean not null default true,
  stripe_product_id text,
  stripe_price_id text,
  stripe_price_cents integer
    check (stripe_price_cents is null or stripe_price_cents >= 0),
  stripe_lookup_key text unique,
  stripe_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into bread_club_delivery_prices (
  id,
  band_key,
  label,
  min_minutes,
  max_minutes,
  price_cents,
  stripe_lookup_key
)
values
  (
    '11000000-0000-4000-8000-000000000001',
    '0-10',
    'Local delivery, 0-10 minutes',
    0,
    10,
    2000,
    'bread_club_delivery_0_10_4week_v1'
  ),
  (
    '11000000-0000-4000-8000-000000000002',
    '11-20',
    'Local delivery, 11-20 minutes',
    11,
    20,
    2800,
    'bread_club_delivery_11_20_4week_v1'
  ),
  (
    '11000000-0000-4000-8000-000000000003',
    '21-30',
    'Local delivery, 21-30 minutes',
    21,
    30,
    4000,
    'bread_club_delivery_21_30_4week_v1'
  )
on conflict (band_key) do update set
  label = excluded.label,
  min_minutes = excluded.min_minutes,
  max_minutes = excluded.max_minutes,
  price_cents = excluded.price_cents,
  stripe_lookup_key = excluded.stripe_lookup_key,
  updated_at = now();

create table if not exists bread_club_memberships (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  plan_id uuid not null references bread_club_plans(id),
  status text not null default 'pending_checkout'
    check (
      status in (
        'pending_checkout',
        'active',
        'past_due',
        'canceling',
        'canceled',
        'incomplete'
      )
    ),
  default_selection jsonb not null default '[]'::jsonb,
  delivery_address jsonb not null,
  delivery_instructions text,
  delivery_check jsonb not null,
  route_fee_cents integer not null check (route_fee_cents >= 0),
  route_band_key text not null,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  stripe_plan_subscription_item_id text,
  stripe_delivery_subscription_item_id text,
  stripe_current_period_end timestamptz,
  stripe_checkout_session_id text unique,
  checkout_cancel_token text unique,
  first_delivery_at timestamptz not null,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  cancellation_reason text,
  pending_plan_id uuid references bread_club_plans(id),
  pending_delivery_address jsonb,
  pending_delivery_check jsonb,
  pending_route_fee_cents integer
    check (pending_route_fee_cents is null or pending_route_fee_cents >= 0),
  pending_route_band_key text,
  consent_version text not null,
  consent_text text not null,
  consented_at timestamptz not null,
  consent_ip_hash text,
  last_payment_failure_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bread_club_memberships_customer_idx
  on bread_club_memberships(customer_id, created_at desc);

create index if not exists bread_club_memberships_status_idx
  on bread_club_memberships(status);

create table if not exists bread_club_cycles (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references bread_club_memberships(id) on delete cascade,
  cycle_number integer not null check (cycle_number > 0),
  status text not null default 'pending_payment'
    check (
      status in (
        'pending_payment',
        'paid',
        'past_due',
        'refund_pending',
        'completed',
        'canceled',
        'refunded'
      )
    ),
  period_start timestamptz not null,
  period_end timestamptz not null,
  plan_price_cents integer not null check (plan_price_cents >= 0),
  delivery_price_cents integer not null check (delivery_price_cents >= 0),
  tax_cents integer not null default 0 check (tax_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  skip_count integer not null default 0 check (skip_count >= 0),
  stripe_invoice_id text unique,
  stripe_payment_intent_id text,
  paid_at timestamptz,
  refunded_at timestamptz,
  stripe_refund_id text,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (membership_id, cycle_number)
);

alter table bread_club_cycles
  drop constraint if exists bread_club_cycles_status_check;
alter table bread_club_cycles
  add constraint bread_club_cycles_status_check
  check (
    status in (
      'pending_payment',
      'paid',
      'past_due',
      'refund_pending',
      'completed',
      'canceled',
      'refunded'
    )
  );

alter table bread_club_memberships
  add column if not exists current_cycle_id uuid
  references bread_club_cycles(id) on delete set null;

create table if not exists bread_club_fulfillments (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references bread_club_memberships(id) on delete cascade,
  cycle_id uuid not null references bread_club_cycles(id) on delete cascade,
  weekly_menu_id uuid not null references weekly_menus(id),
  delivery_window_id uuid not null references delivery_windows(id),
  order_id uuid unique references orders(id) on delete set null,
  status text not null default 'pending_payment'
    check (
      status in (
        'pending_payment',
        'scheduled',
        'skipped',
        'fulfilled',
        'canceled'
      )
    ),
  selection jsonb not null default '[]'::jsonb,
  selection_locked_at timestamptz,
  skipped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (membership_id, weekly_menu_id)
);

create index if not exists bread_club_fulfillments_week_idx
  on bread_club_fulfillments(weekly_menu_id, status);

alter table orders
  add column if not exists source text not null default 'storefront';

update orders
set source = 'storefront'
where source = 'one_time';

alter table orders
  drop constraint if exists orders_source_check;

alter table orders
  add constraint orders_source_check
  check (source in ('storefront', 'bread_club', 'bread_club_addon'));

alter table orders
  add column if not exists bread_club_membership_id uuid
  references bread_club_memberships(id) on delete set null;

alter table orders
  add column if not exists bread_club_fulfillment_id uuid
  references bread_club_fulfillments(id) on delete set null;

alter table orders
  add column if not exists stripe_invoice_id text;

create index if not exists orders_bread_club_membership_idx
  on orders(bread_club_membership_id, created_at desc);

create index if not exists orders_stripe_invoice_idx
  on orders(stripe_invoice_id);

create table if not exists bread_club_rollover_credits (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references bread_club_memberships(id) on delete cascade,
  source_fulfillment_id uuid not null unique
    references bread_club_fulfillments(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  delivery_fee_credit_cents integer not null check (delivery_fee_credit_cents >= 0),
  status text not null default 'available'
    check (status in ('available', 'redeemed', 'expired', 'refunded')),
  expires_at timestamptz not null,
  redeemed_fulfillment_id uuid references bread_club_fulfillments(id),
  stripe_invoice_item_id text,
  delivery_credit_applied_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bread_club_rollover_credits_member_idx
  on bread_club_rollover_credits(membership_id, status, expires_at);

create table if not exists bread_club_addon_checkouts (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references bread_club_memberships(id) on delete cascade,
  fulfillment_id uuid not null references bread_club_fulfillments(id) on delete cascade,
  items jsonb not null,
  subtotal_cents integer not null check (subtotal_cents >= 0),
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'paid', 'expired', 'canceled', 'refunded')),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bread_club_magic_links (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references bread_club_memberships(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  request_ip_hash text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists bread_club_magic_links_email_idx
  on bread_club_magic_links(email, created_at desc);

create table if not exists bread_club_sessions (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references bread_club_memberships(id) on delete cascade,
  session_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists bread_club_sessions_member_idx
  on bread_club_sessions(membership_id, expires_at desc);

create table if not exists processed_stripe_events (
  id text primary key,
  event_type text not null,
  object_id text,
  status text not null default 'processing'
    check (status in ('processing', 'processed', 'failed')),
  attempt_count integer not null default 1 check (attempt_count > 0),
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists bread_club_job_events (
  job_key text primary key,
  job_type text not null,
  membership_id uuid references bread_club_memberships(id) on delete set null,
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 1 check (attempt_count > 0),
  last_error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists bread_club_job_events_status_idx
  on bread_club_job_events(status, updated_at desc);

alter table email_events
  add column if not exists bread_club_membership_id uuid
  references bread_club_memberships(id) on delete set null;

create or replace function bread_club_weekly_loaf_slots(
  p_weekly_menu_id uuid
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(order_item.quantity), 0)::integer
  from bread_club_fulfillments fulfillment
  join orders bakery_order on bakery_order.id = fulfillment.order_id
  join order_items order_item on order_item.order_id = bakery_order.id
  join products product on product.id = order_item.product_id
  where fulfillment.weekly_menu_id = p_weekly_menu_id
    and fulfillment.status in ('pending_payment', 'scheduled')
    and product.category = 'bread';
$$;

create or replace function reserve_bread_club_cycle(
  p_membership_id uuid,
  p_cycle_id uuid,
  p_fulfillments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  membership_row bread_club_memberships%rowtype;
  plan_row bread_club_plans%rowtype;
  cycle_row bread_club_cycles%rowtype;
  settings_row bread_club_settings%rowtype;
  fulfillment_value jsonb;
  selection_value jsonb;
  v_menu_id uuid;
  v_window_id uuid;
  v_fulfillment_id uuid;
  v_order_id uuid;
  v_product_id uuid;
  item_quantity integer;
  selection_quantity integer;
  weekly_subtotal integer;
  item_unit_price integer;
  result_rows jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_fulfillments) <> 'array'
    or jsonb_array_length(p_fulfillments) <> 4 then
    raise exception 'Bread Club cycles require exactly four Sunday deliveries.';
  end if;

  select *
  into settings_row
  from bread_club_settings
  where id = true
  for update;

  select *
  into membership_row
  from bread_club_memberships
  where id = p_membership_id
  for update;

  if membership_row.id is null then
    raise exception 'Bread Club membership was not found.';
  end if;

  select *
  into plan_row
  from bread_club_plans
  where id = coalesce(membership_row.pending_plan_id, membership_row.plan_id)
    and active = true;

  if plan_row.id is null then
    raise exception 'Bread Club plan is not available.';
  end if;

  select *
  into cycle_row
  from bread_club_cycles
  where id = p_cycle_id
    and membership_id = p_membership_id
    and status = 'pending_payment'
  for update;

  if cycle_row.id is null then
    raise exception 'Bread Club billing cycle is not available for reservation.';
  end if;

  weekly_subtotal := cycle_row.plan_price_cents / 4;
  item_unit_price := weekly_subtotal / plan_row.loaves_per_week;

  for fulfillment_value in
    select value from jsonb_array_elements(p_fulfillments)
  loop
    v_menu_id := (fulfillment_value ->> 'weekly_menu_id')::uuid;
    v_window_id := (fulfillment_value ->> 'delivery_window_id')::uuid;

    if jsonb_typeof(fulfillment_value -> 'selection') <> 'array' then
      raise exception 'Each Bread Club Sunday needs a loaf selection.';
    end if;

    select coalesce(sum((value ->> 'quantity')::integer), 0)
    into selection_quantity
    from jsonb_array_elements(fulfillment_value -> 'selection');

    if selection_quantity <> plan_row.loaves_per_week then
      raise exception '% requires % loaf(s) for each Sunday.',
        plan_row.name,
        plan_row.loaves_per_week;
    end if;

    perform 1
    from weekly_menus
    where id = v_menu_id
      and published = true
      and order_cutoff_at > now()
    for update;

    if not found then
      raise exception 'One selected Sunday is no longer open for Bread Club enrollment.';
    end if;

    perform 1
    from delivery_windows
    where id = v_window_id
      and weekly_menu_id = v_menu_id
    for update;

    if not found then
      raise exception 'One selected Sunday delivery window is no longer available.';
    end if;

    if bread_club_weekly_loaf_slots(v_menu_id) + plan_row.loaves_per_week
      > settings_row.max_weekly_loaf_slots then
      raise exception 'Bread Club is full for one of the selected Sundays.';
    end if;

    for selection_value in
      select value from jsonb_array_elements(fulfillment_value -> 'selection')
    loop
      v_product_id := (selection_value ->> 'product_id')::uuid;
      item_quantity := (selection_value ->> 'quantity')::integer;

      if item_quantity is null or item_quantity <= 0 then
        raise exception 'Bread Club loaf quantities must be positive.';
      end if;

      perform 1
      from bread_club_plan_products eligibility
      join products product on product.id = eligibility.product_id
      where eligibility.plan_id = plan_row.id
        and eligibility.product_id = v_product_id
        and eligibility.active = true
        and product.active = true
        and product.category = 'bread';

      if not found then
        raise exception 'One selected loaf is not eligible for this Bread Club plan.';
      end if;

      update weekly_menu_items menu_item
      set sold_quantity = menu_item.sold_quantity + item_quantity
      where menu_item.weekly_menu_id = v_menu_id
        and menu_item.product_id = v_product_id
        and unavailable = false
        and menu_item.sold_quantity + item_quantity
          <= menu_item.available_quantity;

      if not found then
        raise exception 'One selected loaf does not have enough inventory left.';
      end if;
    end loop;

    update delivery_windows
    set reserved = reserved + 1
    where id = v_window_id
      and reserved < capacity;

    if not found then
      raise exception 'One selected Sunday delivery window is full.';
    end if;

    insert into bread_club_fulfillments (
      membership_id,
      cycle_id,
      weekly_menu_id,
      delivery_window_id,
      status,
      selection
    )
    values (
      membership_row.id,
      cycle_row.id,
      v_menu_id,
      v_window_id,
      'pending_payment',
      fulfillment_value -> 'selection'
    )
    returning id into v_fulfillment_id;

    insert into orders (
      customer_id,
      delivery_window_id,
      status,
      subtotal_cents,
      delivery_fee_cents,
      total_cents,
      delivery_address,
      delivery_miles,
      delivery_instructions,
      delivery_check,
      approval_mode,
      checkout_cancel_token,
      source,
      bread_club_membership_id,
      bread_club_fulfillment_id
    )
    values (
      membership_row.customer_id,
      v_window_id,
      'pending_payment',
      weekly_subtotal,
      coalesce(
        membership_row.pending_route_fee_cents,
        membership_row.route_fee_cents
      ),
      weekly_subtotal + coalesce(
        membership_row.pending_route_fee_cents,
        membership_row.route_fee_cents
      ),
      coalesce(
        membership_row.pending_delivery_address,
        membership_row.delivery_address
      ),
      nullif(
        coalesce(
          membership_row.pending_delivery_check,
          membership_row.delivery_check
        ) ->> 'distanceMiles',
        ''
      )::numeric,
      membership_row.delivery_instructions,
      coalesce(
        membership_row.pending_delivery_check,
        membership_row.delivery_check
      ),
      'standard',
      encode(extensions.gen_random_bytes(24), 'hex'),
      'bread_club',
      membership_row.id,
      v_fulfillment_id
    )
    returning id into v_order_id;

    update bread_club_fulfillments
    set order_id = v_order_id
    where id = v_fulfillment_id;

    for selection_value in
      select value from jsonb_array_elements(fulfillment_value -> 'selection')
    loop
      insert into order_items (
        order_id,
        product_id,
        quantity,
        unit_price_cents
      )
      values (
        v_order_id,
        (selection_value ->> 'product_id')::uuid,
        (selection_value ->> 'quantity')::integer,
        item_unit_price
      );
    end loop;

    result_rows := result_rows || jsonb_build_array(
      jsonb_build_object(
        'fulfillment_id', v_fulfillment_id,
        'order_id', v_order_id,
        'weekly_menu_id', v_menu_id,
        'delivery_window_id', v_window_id
      )
    );
  end loop;

  update bread_club_memberships
  set plan_id = coalesce(pending_plan_id, plan_id),
      pending_plan_id = null,
      delivery_address = coalesce(
        pending_delivery_address,
        delivery_address
      ),
      pending_delivery_address = null,
      delivery_check = coalesce(pending_delivery_check, delivery_check),
      pending_delivery_check = null,
      route_fee_cents = coalesce(
        pending_route_fee_cents,
        route_fee_cents
      ),
      pending_route_fee_cents = null,
      route_band_key = coalesce(
        pending_route_band_key,
        route_band_key
      ),
      pending_route_band_key = null,
      current_cycle_id = cycle_row.id,
      updated_at = now()
  where id = membership_row.id;

  return result_rows;
end;
$$;

create or replace function activate_bread_club_cycle(
  p_cycle_id uuid,
  p_stripe_invoice_id text,
  p_stripe_payment_intent_id text default null,
  p_paid_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update bread_club_cycles
  set status = 'paid',
      stripe_invoice_id = coalesce(stripe_invoice_id, p_stripe_invoice_id),
      stripe_payment_intent_id = coalesce(
        stripe_payment_intent_id,
        p_stripe_payment_intent_id
      ),
      paid_at = coalesce(paid_at, p_paid_at),
      updated_at = now()
  where id = p_cycle_id
    and status in ('pending_payment', 'past_due', 'paid');

  update bread_club_fulfillments
  set status = 'scheduled',
      updated_at = now()
  where cycle_id = p_cycle_id
    and status = 'pending_payment';

  update orders
  set status = 'paid',
      stripe_invoice_id = coalesce(stripe_invoice_id, p_stripe_invoice_id),
      paid_at = coalesce(paid_at, p_paid_at),
      updated_at = now()
  where bread_club_fulfillment_id in (
    select id
    from bread_club_fulfillments
    where cycle_id = p_cycle_id
  )
    and status = 'pending_payment';
end;
$$;

create or replace function release_bread_club_cycle(
  p_cycle_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  fulfillment_row record;
begin
  for fulfillment_row in
    select id, order_id
    from bread_club_fulfillments
    where cycle_id = p_cycle_id
      and status = 'pending_payment'
    for update
  loop
    perform release_order_inventory(fulfillment_row.order_id);

    update orders
    set status = 'canceled',
        updated_at = now()
    where id = fulfillment_row.order_id
      and status = 'pending_payment';

    update bread_club_fulfillments
    set status = 'canceled',
        updated_at = now()
    where id = fulfillment_row.id;
  end loop;

  update bread_club_cycles
  set status = 'canceled',
      updated_at = now()
  where id = p_cycle_id
    and status = 'pending_payment';
end;
$$;

create or replace function begin_bread_club_cycle_refund(
  p_cycle_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  cycle_row bread_club_cycles%rowtype;
  previous_status text;
begin
  select *
  into cycle_row
  from bread_club_cycles
  where id = p_cycle_id
    and status in ('paid', 'past_due', 'refund_pending', 'refunded')
  for update;

  if cycle_row.id is null then
    raise exception 'A refundable Bread Club cycle was not found.';
  end if;

  if cycle_row.status in ('refund_pending', 'refunded') then
    return cycle_row.status;
  end if;

  if exists (
    select 1
    from bread_club_fulfillments fulfillment
    join orders bakery_order on bakery_order.id = fulfillment.order_id
    where fulfillment.cycle_id = p_cycle_id
      and bakery_order.status in ('baking', 'out_for_delivery', 'delivered')
  ) then
    raise exception 'This cycle already contains a delivery in production or completed.';
  end if;

  if exists (
    select 1
    from bread_club_rollover_credits credit
    join bread_club_fulfillments fulfillment
      on fulfillment.id = credit.source_fulfillment_id
    where fulfillment.cycle_id = p_cycle_id
      and (
        credit.status = 'redeemed'
        or credit.delivery_credit_applied_at is not null
      )
  ) then
    raise exception 'This cycle has a rollover or delivery credit that was already used.';
  end if;

  previous_status := cycle_row.status;

  update bread_club_cycles
  set status = 'refund_pending',
      updated_at = now()
  where id = cycle_row.id;

  return previous_status;
end;
$$;

create or replace function refund_bread_club_cycle(
  p_cycle_id uuid,
  p_stripe_refund_id text,
  p_admin_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cycle_row bread_club_cycles%rowtype;
  fulfillment_row record;
begin
  select *
  into cycle_row
  from bread_club_cycles
  where id = p_cycle_id
    and status in ('refund_pending', 'refunded')
  for update;

  if cycle_row.id is null then
    raise exception 'The Bread Club cycle is not ready to finalize a refund.';
  end if;

  if cycle_row.status = 'refunded' then
    return;
  end if;

  if exists (
    select 1
    from bread_club_fulfillments fulfillment
    join orders bakery_order on bakery_order.id = fulfillment.order_id
    where fulfillment.cycle_id = p_cycle_id
      and bakery_order.status in ('baking', 'out_for_delivery', 'delivered')
  ) then
    raise exception 'This cycle already contains a delivery in production or completed.';
  end if;

  if exists (
    select 1
    from bread_club_rollover_credits credit
    join bread_club_fulfillments fulfillment
      on fulfillment.id = credit.source_fulfillment_id
    where fulfillment.cycle_id = p_cycle_id
      and (
        credit.status = 'redeemed'
        or credit.delivery_credit_applied_at is not null
      )
  ) then
    raise exception 'This cycle has a rollover or delivery credit that was already used.';
  end if;

  for fulfillment_row in
    select id, order_id
    from bread_club_fulfillments
    where cycle_id = p_cycle_id
      and status in ('pending_payment', 'scheduled')
    for update
  loop
    perform release_order_inventory(fulfillment_row.order_id);
    update orders
    set status = 'canceled',
        refunded_at = now(),
        stripe_refund_id = p_stripe_refund_id,
        admin_decision_note = p_admin_note,
        updated_at = now()
    where id = fulfillment_row.order_id;
    update bread_club_fulfillments
    set status = 'canceled',
        updated_at = now()
    where id = fulfillment_row.id;
  end loop;

  update bread_club_cycles
  set status = 'refunded',
      refunded_at = now(),
      stripe_refund_id = p_stripe_refund_id,
      admin_note = p_admin_note,
      updated_at = now()
  where id = cycle_row.id;

  update bread_club_rollover_credits credit
  set status = 'refunded',
      refunded_at = now(),
      updated_at = now()
  from bread_club_fulfillments fulfillment
  where fulfillment.id = credit.source_fulfillment_id
    and fulfillment.cycle_id = p_cycle_id
    and credit.status in ('available', 'expired');
end;
$$;

create or replace function swap_bread_club_selection(
  p_fulfillment_id uuid,
  p_selection jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  fulfillment_row bread_club_fulfillments%rowtype;
  membership_row bread_club_memberships%rowtype;
  plan_row bread_club_plans%rowtype;
  cycle_row bread_club_cycles%rowtype;
  v_order_id uuid;
  selection_value jsonb;
  previous_selection_value jsonb;
  v_product_id uuid;
  previous_product_id uuid;
  item_quantity integer;
  previous_quantity integer;
  previous_order_item_id uuid;
  previous_order_item_quantity integer;
  selection_quantity integer;
  item_unit_price integer;
begin
  if jsonb_typeof(p_selection) <> 'array' then
    raise exception 'Choose a valid Bread Club loaf selection.';
  end if;

  select *
  into fulfillment_row
  from bread_club_fulfillments
  where id = p_fulfillment_id
    and status = 'scheduled'
  for update;

  if fulfillment_row.id is null then
    raise exception 'That Bread Club delivery cannot be changed.';
  end if;

  perform 1
  from weekly_menus
  where id = fulfillment_row.weekly_menu_id
    and order_cutoff_at > now()
  for update;

  if not found then
    raise exception 'The Thursday selection cutoff has passed.';
  end if;

  select *
  into membership_row
  from bread_club_memberships
  where id = fulfillment_row.membership_id;

  select *
  into plan_row
  from bread_club_plans
  where id = membership_row.plan_id;

  select *
  into cycle_row
  from bread_club_cycles
  where id = fulfillment_row.cycle_id;

  select coalesce(sum((value ->> 'quantity')::integer), 0)
  into selection_quantity
  from jsonb_array_elements(p_selection);

  if selection_quantity <> plan_row.loaves_per_week then
    raise exception '% requires % loaf(s) for each Sunday.',
      plan_row.name,
      plan_row.loaves_per_week;
  end if;

  v_order_id := fulfillment_row.order_id;
  item_unit_price :=
    (cycle_row.plan_price_cents / 4) / plan_row.loaves_per_week;

  for previous_selection_value in
    select value from jsonb_array_elements(fulfillment_row.selection)
  loop
    previous_product_id :=
      (previous_selection_value ->> 'product_id')::uuid;
    previous_quantity :=
      (previous_selection_value ->> 'quantity')::integer;

    update weekly_menu_items
    set sold_quantity = greatest(sold_quantity - previous_quantity, 0)
    where weekly_menu_id = fulfillment_row.weekly_menu_id
      and product_id = previous_product_id;

    select id, quantity
    into previous_order_item_id, previous_order_item_quantity
    from order_items
    where order_id = v_order_id
      and product_id = previous_product_id
      and unit_price_cents > 0
    order by unit_price_cents desc
    limit 1
    for update;

    if previous_order_item_id is null
      or previous_order_item_quantity < previous_quantity then
      raise exception 'The existing Bread Club loaf selection is inconsistent.';
    end if;

    if previous_order_item_quantity = previous_quantity then
      delete from order_items
      where id = previous_order_item_id;
    else
      update order_items
      set quantity = quantity - previous_quantity,
          unit_price_cents = 0
      where id = previous_order_item_id;
    end if;
  end loop;

  for selection_value in
    select value from jsonb_array_elements(p_selection)
  loop
    v_product_id := (selection_value ->> 'product_id')::uuid;
    item_quantity := (selection_value ->> 'quantity')::integer;

    perform 1
    from bread_club_plan_products eligibility
    join products product on product.id = eligibility.product_id
    where eligibility.plan_id = plan_row.id
      and eligibility.product_id = v_product_id
      and eligibility.active = true
      and product.active = true
      and product.category = 'bread';

    if not found then
      raise exception 'One selected loaf is not eligible for this plan.';
    end if;

    update weekly_menu_items menu_item
    set sold_quantity = menu_item.sold_quantity + item_quantity
    where menu_item.weekly_menu_id = fulfillment_row.weekly_menu_id
      and menu_item.product_id = v_product_id
      and unavailable = false
      and menu_item.sold_quantity + item_quantity
        <= menu_item.available_quantity;

    if not found then
      raise exception 'One selected loaf does not have enough inventory left.';
    end if;

    insert into order_items (
      order_id,
      product_id,
      quantity,
      unit_price_cents
    )
    values (
      v_order_id,
      v_product_id,
      item_quantity,
      item_unit_price
    );
  end loop;

  update bread_club_fulfillments
  set selection = p_selection,
      updated_at = now()
  where id = fulfillment_row.id;
end;
$$;

create or replace function update_bread_club_address(
  p_membership_id uuid,
  p_delivery_address jsonb,
  p_delivery_instructions text,
  p_delivery_check jsonb,
  p_route_fee_cents integer,
  p_route_band_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_route_fee_cents < 0 then
    raise exception 'Bread Club delivery fee cannot be negative.';
  end if;

  update bread_club_memberships
  set delivery_address = p_delivery_address,
      delivery_instructions = p_delivery_instructions,
      delivery_check = p_delivery_check,
      pending_route_fee_cents = p_route_fee_cents,
      pending_route_band_key = p_route_band_key,
      updated_at = now()
  where id = p_membership_id
    and status in ('active', 'past_due', 'canceling');

  if not found then
    raise exception 'Active Bread Club membership was not found.';
  end if;

  update orders bakery_order
  set delivery_address = p_delivery_address,
      delivery_instructions = p_delivery_instructions,
      delivery_check = p_delivery_check,
      delivery_miles = nullif(
        coalesce(
          p_delivery_check ->> 'distanceMiles',
          p_delivery_check ->> 'miles'
        ),
        ''
      )::numeric,
      updated_at = now()
  from bread_club_fulfillments fulfillment
  where fulfillment.membership_id = p_membership_id
    and fulfillment.order_id = bakery_order.id
    and fulfillment.status = 'scheduled'
    and bakery_order.status in ('paid', 'baking');
end;
$$;

create or replace function skip_bread_club_fulfillment(
  p_fulfillment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  fulfillment_row bread_club_fulfillments%rowtype;
  cycle_row bread_club_cycles%rowtype;
  settings_row bread_club_settings%rowtype;
  loaf_quantity integer;
  delivery_credit integer;
  credit_id uuid;
begin
  select *
  into settings_row
  from bread_club_settings
  where id = true;

  select *
  into fulfillment_row
  from bread_club_fulfillments
  where id = p_fulfillment_id
    and status = 'scheduled'
  for update;

  if fulfillment_row.id is null then
    raise exception 'That Bread Club delivery cannot be skipped.';
  end if;

  perform 1
  from weekly_menus
  where id = fulfillment_row.weekly_menu_id
    and order_cutoff_at > now()
  for update;

  if not found then
    raise exception 'The Thursday skip cutoff has passed.';
  end if;

  select *
  into cycle_row
  from bread_club_cycles
  where id = fulfillment_row.cycle_id
  for update;

  if cycle_row.skip_count >= settings_row.skip_limit_per_cycle then
    raise exception 'The one skip included in this four-week cycle has already been used.';
  end if;

  if exists (
    select 1
    from bread_club_addon_checkouts
    where fulfillment_id = fulfillment_row.id
      and status = 'paid'
  ) then
    raise exception 'Contact the bakery before skipping a Sunday with paid add-ons.';
  end if;

  if exists (
    select 1
    from bread_club_rollover_credits
    where redeemed_fulfillment_id = fulfillment_row.id
      and status = 'redeemed'
  ) then
    raise exception 'Contact the bakery before skipping a Sunday using rollover loaves.';
  end if;

  select
    coalesce(sum(order_item.quantity), 0)::integer,
    bakery_order.delivery_fee_cents
  into loaf_quantity, delivery_credit
  from orders bakery_order
  join order_items order_item on order_item.order_id = bakery_order.id
  join products product on product.id = order_item.product_id
  where bakery_order.id = fulfillment_row.order_id
    and product.category = 'bread'
  group by bakery_order.delivery_fee_cents;

  if loaf_quantity is null or loaf_quantity <= 0 then
    raise exception 'No Bread Club loaf was found for this delivery.';
  end if;

  perform release_order_inventory(fulfillment_row.order_id);

  update orders
  set status = 'canceled',
      updated_at = now()
  where id = fulfillment_row.order_id;

  update bread_club_fulfillments
  set status = 'skipped',
      skipped_at = now(),
      updated_at = now()
  where id = fulfillment_row.id;

  update bread_club_cycles
  set skip_count = skip_count + 1,
      updated_at = now()
  where id = cycle_row.id;

  insert into bread_club_rollover_credits (
    membership_id,
    source_fulfillment_id,
    quantity,
    delivery_fee_credit_cents,
    expires_at
  )
  values (
    fulfillment_row.membership_id,
    fulfillment_row.id,
    loaf_quantity,
    delivery_credit,
    now() + make_interval(days => settings_row.rollover_credit_days)
  )
  returning id into credit_id;

  return jsonb_build_object(
    'credit_id', credit_id,
    'quantity', loaf_quantity,
    'delivery_fee_credit_cents', delivery_credit
  );
end;
$$;

create or replace function redeem_bread_club_credit(
  p_credit_id uuid,
  p_fulfillment_id uuid,
  p_product_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  credit_row bread_club_rollover_credits%rowtype;
  fulfillment_row bread_club_fulfillments%rowtype;
  membership_row bread_club_memberships%rowtype;
  settings_row bread_club_settings%rowtype;
  existing_item_id uuid;
begin
  select *
  into settings_row
  from bread_club_settings
  where id = true
  for update;

  select *
  into credit_row
  from bread_club_rollover_credits
  where id = p_credit_id
    and status = 'available'
    and expires_at > now()
  for update;

  if credit_row.id is null then
    raise exception 'That rollover credit is no longer available.';
  end if;

  select *
  into fulfillment_row
  from bread_club_fulfillments
  where id = p_fulfillment_id
    and membership_id = credit_row.membership_id
    and status = 'scheduled'
  for update;

  if fulfillment_row.id is null then
    raise exception 'Choose an upcoming Bread Club Sunday for this credit.';
  end if;

  perform 1
  from weekly_menus
  where id = fulfillment_row.weekly_menu_id
    and order_cutoff_at > now()
  for update;

  if not found then
    raise exception 'The Thursday selection cutoff has passed.';
  end if;

  select *
  into membership_row
  from bread_club_memberships
  where id = fulfillment_row.membership_id;

  perform 1
  from bread_club_plan_products eligibility
  join products product on product.id = eligibility.product_id
  where eligibility.plan_id = membership_row.plan_id
    and eligibility.product_id = p_product_id
    and eligibility.active = true
    and product.active = true
    and product.category = 'bread';

  if not found then
    raise exception 'That loaf is not eligible for this membership.';
  end if;

  if bread_club_weekly_loaf_slots(fulfillment_row.weekly_menu_id)
    + credit_row.quantity > settings_row.max_weekly_loaf_slots then
    raise exception 'Bread Club loaf capacity is full for that Sunday.';
  end if;

  update weekly_menu_items
  set sold_quantity = sold_quantity + credit_row.quantity
  where weekly_menu_id = fulfillment_row.weekly_menu_id
    and product_id = p_product_id
    and unavailable = false
    and sold_quantity + credit_row.quantity <= available_quantity;

  if not found then
    raise exception 'That loaf does not have enough inventory left.';
  end if;

  select id
  into existing_item_id
  from order_items
  where order_id = fulfillment_row.order_id
    and product_id = p_product_id
  limit 1;

  if existing_item_id is null then
    insert into order_items (order_id, product_id, quantity, unit_price_cents)
    values (
      fulfillment_row.order_id,
      p_product_id,
      credit_row.quantity,
      0
    );
  else
    update order_items
    set quantity = quantity + credit_row.quantity
    where id = existing_item_id;
  end if;

  update bread_club_rollover_credits
  set status = 'redeemed',
      redeemed_fulfillment_id = fulfillment_row.id,
      updated_at = now()
  where id = credit_row.id;
end;
$$;

create or replace function reserve_bread_club_addon_inventory(
  p_addon_checkout_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  addon_row bread_club_addon_checkouts%rowtype;
  fulfillment_row bread_club_fulfillments%rowtype;
  item_value jsonb;
  v_product_id uuid;
  item_quantity integer;
begin
  select *
  into addon_row
  from bread_club_addon_checkouts
  where id = p_addon_checkout_id
    and status = 'pending_payment'
  for update;

  if addon_row.id is null then
    raise exception 'That add-on checkout is no longer available.';
  end if;

  select *
  into fulfillment_row
  from bread_club_fulfillments
  where id = addon_row.fulfillment_id
    and membership_id = addon_row.membership_id
    and status = 'scheduled'
  for update;

  if fulfillment_row.id is null then
    raise exception 'Choose an active Bread Club Sunday for add-ons.';
  end if;

  perform 1
  from weekly_menus
  where id = fulfillment_row.weekly_menu_id
    and order_cutoff_at > now()
  for update;

  if not found then
    raise exception 'The Thursday add-on cutoff has passed.';
  end if;

  for item_value in
    select value from jsonb_array_elements(addon_row.items)
  loop
    v_product_id := (item_value ->> 'product_id')::uuid;
    item_quantity := (item_value ->> 'quantity')::integer;

    update weekly_menu_items menu_item
    set sold_quantity = menu_item.sold_quantity + item_quantity
    from products product
    where menu_item.weekly_menu_id = fulfillment_row.weekly_menu_id
      and menu_item.product_id = v_product_id
      and product.id = v_product_id
      and product.active = true
      and product.category = 'add-on'
      and menu_item.unavailable = false
      and menu_item.sold_quantity + item_quantity <= menu_item.available_quantity;

    if not found then
      raise exception 'One add-on does not have enough inventory left.';
    end if;
  end loop;
end;
$$;

create or replace function release_bread_club_addon_inventory(
  p_addon_checkout_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  addon_row bread_club_addon_checkouts%rowtype;
  fulfillment_row bread_club_fulfillments%rowtype;
  item_value jsonb;
begin
  select *
  into addon_row
  from bread_club_addon_checkouts
  where id = p_addon_checkout_id
    and status = 'pending_payment'
  for update;

  if addon_row.id is null then
    return;
  end if;

  select *
  into fulfillment_row
  from bread_club_fulfillments
  where id = addon_row.fulfillment_id;

  for item_value in
    select value from jsonb_array_elements(addon_row.items)
  loop
    update weekly_menu_items
    set sold_quantity = greatest(
      sold_quantity - (item_value ->> 'quantity')::integer,
      0
    )
    where weekly_menu_id = fulfillment_row.weekly_menu_id
      and product_id = (item_value ->> 'product_id')::uuid;
  end loop;

  update bread_club_addon_checkouts
  set status = 'expired',
      updated_at = now()
  where id = addon_row.id;
end;
$$;

create or replace function complete_bread_club_addon_checkout(
  p_addon_checkout_id uuid,
  p_payment_intent_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  addon_row bread_club_addon_checkouts%rowtype;
  fulfillment_row bread_club_fulfillments%rowtype;
  item_value jsonb;
  existing_item_id uuid;
begin
  select *
  into addon_row
  from bread_club_addon_checkouts
  where id = p_addon_checkout_id
    and status = 'pending_payment'
  for update;

  if addon_row.id is null then
    return;
  end if;

  select *
  into fulfillment_row
  from bread_club_fulfillments
  where id = addon_row.fulfillment_id
    and membership_id = addon_row.membership_id
    and status = 'scheduled'
  for update;

  if fulfillment_row.id is null or fulfillment_row.order_id is null then
    raise exception 'The Bread Club delivery for these add-ons is unavailable.';
  end if;

  for item_value in
    select value from jsonb_array_elements(addon_row.items)
  loop
    select id
    into existing_item_id
    from order_items
    where order_id = fulfillment_row.order_id
      and product_id = (item_value ->> 'product_id')::uuid
    limit 1;

    if existing_item_id is null then
      insert into order_items (
        order_id,
        product_id,
        quantity,
        unit_price_cents
      )
      values (
        fulfillment_row.order_id,
        (item_value ->> 'product_id')::uuid,
        (item_value ->> 'quantity')::integer,
        (item_value ->> 'unit_price_cents')::integer
      );
    else
      update order_items
      set quantity = quantity + (item_value ->> 'quantity')::integer
      where id = existing_item_id;
    end if;
  end loop;

  update orders
  set subtotal_cents = subtotal_cents + addon_row.subtotal_cents,
      total_cents = total_cents + addon_row.subtotal_cents,
      updated_at = now()
  where id = fulfillment_row.order_id;

  update bread_club_addon_checkouts
  set status = 'paid',
      stripe_payment_intent_id = p_payment_intent_id,
      paid_at = now(),
      updated_at = now()
  where id = addon_row.id;
end;
$$;

create or replace function claim_stripe_event(
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

  select status
  into existing_status
  from processed_stripe_events
  where id = p_event_id
  for update;

  if existing_status = 'failed' then
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

revoke all on function bread_club_weekly_loaf_slots(uuid)
  from public, anon, authenticated;
revoke all on function reserve_bread_club_cycle(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function activate_bread_club_cycle(uuid, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function release_bread_club_cycle(uuid)
  from public, anon, authenticated;
revoke all on function begin_bread_club_cycle_refund(uuid)
  from public, anon, authenticated;
revoke all on function refund_bread_club_cycle(uuid, text, text)
  from public, anon, authenticated;
revoke all on function swap_bread_club_selection(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function update_bread_club_address(
  uuid,
  jsonb,
  text,
  jsonb,
  integer,
  text
) from public, anon, authenticated;
revoke all on function skip_bread_club_fulfillment(uuid)
  from public, anon, authenticated;
revoke all on function redeem_bread_club_credit(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function reserve_bread_club_addon_inventory(uuid)
  from public, anon, authenticated;
revoke all on function release_bread_club_addon_inventory(uuid)
  from public, anon, authenticated;
revoke all on function complete_bread_club_addon_checkout(uuid, text)
  from public, anon, authenticated;
revoke all on function claim_stripe_event(text, text, text)
  from public, anon, authenticated;

grant execute on function bread_club_weekly_loaf_slots(uuid)
  to service_role;
grant execute on function reserve_bread_club_cycle(uuid, uuid, jsonb)
  to service_role;
grant execute on function activate_bread_club_cycle(
  uuid,
  text,
  text,
  timestamptz
) to service_role;
grant execute on function release_bread_club_cycle(uuid)
  to service_role;
grant execute on function begin_bread_club_cycle_refund(uuid)
  to service_role;
grant execute on function refund_bread_club_cycle(uuid, text, text)
  to service_role;
grant execute on function swap_bread_club_selection(uuid, jsonb)
  to service_role;
grant execute on function update_bread_club_address(
  uuid,
  jsonb,
  text,
  jsonb,
  integer,
  text
) to service_role;
grant execute on function skip_bread_club_fulfillment(uuid)
  to service_role;
grant execute on function redeem_bread_club_credit(uuid, uuid, uuid)
  to service_role;
grant execute on function reserve_bread_club_addon_inventory(uuid)
  to service_role;
grant execute on function release_bread_club_addon_inventory(uuid)
  to service_role;
grant execute on function complete_bread_club_addon_checkout(uuid, text)
  to service_role;
grant execute on function claim_stripe_event(text, text, text)
  to service_role;

alter table bread_club_settings enable row level security;
alter table bread_club_plans enable row level security;
alter table bread_club_plan_products enable row level security;
alter table bread_club_delivery_prices enable row level security;
alter table bread_club_memberships enable row level security;
alter table bread_club_cycles enable row level security;
alter table bread_club_fulfillments enable row level security;
alter table bread_club_rollover_credits enable row level security;
alter table bread_club_addon_checkouts enable row level security;
alter table bread_club_magic_links enable row level security;
alter table bread_club_sessions enable row level security;
alter table processed_stripe_events enable row level security;
alter table bread_club_job_events enable row level security;
