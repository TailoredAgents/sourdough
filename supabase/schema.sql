create extension if not exists "pgcrypto";

do $$
begin
  create type product_category as enum ('bread', 'add-on');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type order_status as enum (
    'draft',
    'pending_payment',
    'pending_approval_payment',
    'pending_approval',
    'paid',
    'baking',
    'out_for_delivery',
    'delivered',
    'canceled'
  );
exception
  when duplicate_object then null;
end $$;

alter type order_status add value if not exists 'pending_approval_payment' after 'pending_payment';
alter type order_status add value if not exists 'pending_approval' after 'pending_approval_payment';

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  category product_category not null,
  description text not null,
  ingredients text[] not null default '{}',
  allergens text[] not null default '{}',
  price_cents integer not null check (price_cents >= 0),
  stripe_product_id text,
  stripe_price_id text,
  stripe_price_cents integer check (stripe_price_cents is null or stripe_price_cents >= 0),
  stripe_synced_at timestamptz,
  image_url text,
  image_style text not null default 'from-stone-100 via-amber-100 to-orange-200',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table products
  add column if not exists image_url text;

alter table products
  add column if not exists image_style text not null default 'from-stone-100 via-amber-100 to-orange-200';

alter table products
  add column if not exists stripe_product_id text;

alter table products
  add column if not exists stripe_price_id text;

alter table products
  add column if not exists stripe_price_cents integer check (stripe_price_cents is null or stripe_price_cents >= 0);

alter table products
  add column if not exists stripe_synced_at timestamptz;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'product-images',
  'product-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists weekly_menus (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  order_cutoff_at timestamptz not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  published boolean not null default false,
  auto_generated boolean not null default false,
  generation_key text unique,
  source_weekly_menu_id uuid references weekly_menus(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table weekly_menus
  add column if not exists auto_generated boolean not null default false;

alter table weekly_menus
  add column if not exists generation_key text unique;

alter table weekly_menus
  add column if not exists source_weekly_menu_id uuid references weekly_menus(id) on delete set null;

create table if not exists weekly_menu_items (
  id uuid primary key default gen_random_uuid(),
  weekly_menu_id uuid not null references weekly_menus(id) on delete cascade,
  product_id uuid not null references products(id),
  available_quantity integer not null check (available_quantity >= 0),
  sold_quantity integer not null default 0 check (sold_quantity >= 0),
  featured boolean not null default false,
  unavailable boolean not null default false,
  check (sold_quantity <= available_quantity),
  unique (weekly_menu_id, product_id)
);

alter table weekly_menu_items
  add column if not exists unavailable boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'weekly_menu_items_sold_lte_available'
  ) then
    alter table weekly_menu_items
      add constraint weekly_menu_items_sold_lte_available
      check (sold_quantity <= available_quantity);
  end if;
end $$;

create table if not exists delivery_settings (
  id boolean primary key default true,
  center_lat numeric(9,6) not null default 34.236800,
  center_lng numeric(9,6) not null default -84.490800,
  radius_miles numeric(5,2) not null default 12,
  delivery_fee_cents integer not null default 600,
  allowed_postal_codes text[] not null default array['30114', '30115', '30107', '30183', '30188', '30189'],
  service_area_copy text not null default 'Delivery is available in selected ZIP codes around Canton and Woodstock: 30114, 30115, 30107, 30183, 30188, and 30189.',
  check (id)
);

alter table delivery_settings
  add column if not exists allowed_postal_codes text[] not null default array['30114', '30115', '30107', '30183', '30188', '30189'];

alter table delivery_settings
  add column if not exists service_area_copy text not null default 'Delivery is available in selected ZIP codes around Canton and Woodstock: 30114, 30115, 30107, 30183, 30188, and 30189.';

create table if not exists delivery_windows (
  id uuid primary key default gen_random_uuid(),
  weekly_menu_id uuid not null references weekly_menus(id) on delete cascade,
  label text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer not null check (capacity >= 0),
  reserved integer not null default 0 check (reserved >= 0),
  check (reserved <= capacity)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'delivery_windows_reserved_lte_capacity'
  ) then
    alter table delivery_windows
      add constraint delivery_windows_reserved_lte_capacity
      check (reserved <= capacity);
  end if;
end $$;

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id),
  delivery_window_id uuid references delivery_windows(id),
  status order_status not null default 'pending_payment',
  stripe_checkout_session_id text unique,
  subtotal_cents integer not null default 0,
  delivery_fee_cents integer not null default 0,
  tax_cents integer not null default 0 check (tax_cents >= 0),
  total_cents integer not null default 0,
  delivery_address jsonb not null,
  delivery_miles numeric(5,2),
  delivery_instructions text,
  delivery_check jsonb,
  notes text,
  next_week_ok boolean,
  approval_mode text,
  approved_at timestamptz,
  denied_at timestamptz,
  refunded_at timestamptz,
  stripe_refund_id text,
  admin_decision_note text,
  paid_at timestamptz,
  checkout_cancel_token text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table orders
  add column if not exists delivery_instructions text;

alter table orders
  add column if not exists delivery_check jsonb;

alter table orders
  add column if not exists checkout_cancel_token text unique;

alter table orders
  add column if not exists next_week_ok boolean;

alter table orders
  add column if not exists approval_mode text;

alter table orders
  add column if not exists approved_at timestamptz;

alter table orders
  add column if not exists denied_at timestamptz;

alter table orders
  add column if not exists refunded_at timestamptz;

alter table orders
  add column if not exists stripe_refund_id text;

alter table orders
  add column if not exists admin_decision_note text;

alter table orders
  add column if not exists tax_cents integer not null default 0
  check (tax_cents >= 0);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid not null references products(id),
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0)
);

create table if not exists customer_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete set null,
  customer_email text,
  subject text not null,
  body text not null,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

create table if not exists customer_message_replies (
  id uuid primary key default gen_random_uuid(),
  customer_message_id uuid not null references customer_messages(id) on delete cascade,
  admin_email text not null,
  recipient text not null,
  subject text not null,
  body text not null,
  status text not null default 'pending',
  provider_id text,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists ai_knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists email_events (
  id uuid primary key default gen_random_uuid(),
  template text not null,
  recipient text not null,
  order_id uuid references orders(id) on delete set null,
  customer_message_id uuid references customer_messages(id) on delete set null,
  status text not null,
  provider_id text,
  provider_response jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  key_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_events_scope_key_created_idx
  on rate_limit_events(scope, key_hash, created_at desc);

create index if not exists rate_limit_events_created_idx
  on public.rate_limit_events(created_at);

create or replace function public.consume_rate_limit(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  remaining integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  event_count integer;
begin
  if nullif(trim(p_scope), '') is null
    or nullif(trim(p_key_hash), '') is null
    or p_limit < 1
    or p_limit > 10000
    or p_window_seconds < 1
    or p_window_seconds > 2592000
  then
    raise exception 'Invalid rate-limit parameters.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_scope || ':' || p_key_hash, 0)
  );

  delete from public.rate_limit_events
  where scope = p_scope
    and key_hash = p_key_hash
    and created_at < now() - pg_catalog.make_interval(secs => p_window_seconds);

  select count(*)::integer
  into event_count
  from public.rate_limit_events
  where scope = p_scope
    and key_hash = p_key_hash
    and created_at >= now() - pg_catalog.make_interval(secs => p_window_seconds);

  if event_count >= p_limit then
    return query select false, 0;
    return;
  end if;

  insert into public.rate_limit_events (scope, key_hash)
  values (p_scope, p_key_hash);

  return query
  select true, pg_catalog.greatest(p_limit - event_count - 1, 0);
end;
$$;

create or replace function public.cleanup_rate_limit_events()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  deleted_count integer;
begin
  with expired as (
    select event.id
    from public.rate_limit_events event
    where event.created_at < now() - interval '31 days'
    order by event.created_at
    limit 10000
  )
  delete from public.rate_limit_events event
  using expired
  where event.id = expired.id;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on table public.rate_limit_events
  from public, anon, authenticated;
revoke all on function public.consume_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.cleanup_rate_limit_events()
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, text, integer, integer)
  to service_role;
grant execute on function public.cleanup_rate_limit_events()
  to service_role;

create or replace function reserve_order_inventory(
  p_delivery_window_id uuid,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  item jsonb;
  item_product_id uuid;
  item_quantity integer;
  window_weekly_menu_id uuid;
begin
  select delivery_window.weekly_menu_id
  into window_weekly_menu_id
  from delivery_windows delivery_window
  join weekly_menus weekly_menu
    on weekly_menu.id = delivery_window.weekly_menu_id
  where delivery_window.id = p_delivery_window_id
    and delivery_window.ends_at > now()
    and weekly_menu.published = true
  for update of delivery_window;

  if window_weekly_menu_id is null then
    raise exception 'Delivery window is no longer available.';
  end if;

  update delivery_windows
  set reserved = reserved + 1
  where id = p_delivery_window_id
    and reserved < capacity;

  if not found then
    raise exception 'Delivery window is full.';
  end if;

  for item in
    select item_value
    from jsonb_array_elements(p_items) as items(item_value)
    order by (item_value ->> 'product_id')::uuid
  loop
    item_product_id := (item ->> 'product_id')::uuid;
    item_quantity := (item ->> 'quantity')::integer;

    if item_quantity is null or item_quantity <= 0 then
      raise exception 'Invalid item quantity.';
    end if;

    update weekly_menu_items menu_item
    set sold_quantity = menu_item.sold_quantity + item_quantity
    where menu_item.weekly_menu_id = window_weekly_menu_id
      and menu_item.product_id = item_product_id
      and menu_item.unavailable = false
      and menu_item.sold_quantity + item_quantity <= menu_item.available_quantity
      and exists (
        select 1
        from products product
        where product.id = menu_item.product_id
          and product.active = true
      );

    if not found then
      raise exception 'One item is unavailable or does not have enough inventory left.';
    end if;
  end loop;
end;
$$;

create or replace function release_order_inventory(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  order_row orders%rowtype;
  item_row record;
  window_weekly_menu_id uuid;
begin
  select *
  into order_row
  from orders
  where id = p_order_id;

  if order_row.id is null or order_row.delivery_window_id is null then
    return;
  end if;

  select weekly_menu_id
  into window_weekly_menu_id
  from delivery_windows
  where id = order_row.delivery_window_id;

  if window_weekly_menu_id is null then
    return;
  end if;

  update delivery_windows
  set reserved = greatest(reserved - 1, 0)
  where id = order_row.delivery_window_id;

  for item_row in
    select product_id, quantity
    from order_items
    where order_id = p_order_id
    order by product_id
  loop
    update weekly_menu_items
    set sold_quantity = greatest(sold_quantity - item_row.quantity, 0)
    where weekly_menu_id = window_weekly_menu_id
      and product_id = item_row.product_id;
  end loop;
end;
$$;

alter table products enable row level security;
alter table weekly_menus enable row level security;
alter table weekly_menu_items enable row level security;
alter table delivery_settings enable row level security;
alter table delivery_windows enable row level security;
alter table customers enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table customer_messages enable row level security;
alter table customer_message_replies enable row level security;
alter table ai_knowledge_entries enable row level security;
alter table admin_users enable row level security;
alter table email_events enable row level security;
alter table rate_limit_events enable row level security;

drop policy if exists "Public can read active products" on products;
create policy "Public can read active products" on products
  for select using (active = true);

drop policy if exists "Public can read published menus" on weekly_menus;
create policy "Public can read published menus" on weekly_menus
  for select using (published = true);

drop policy if exists "Public can read published menu items" on weekly_menu_items;
create policy "Public can read published menu items" on weekly_menu_items
  for select using (
    exists (
      select 1 from weekly_menus
      where weekly_menus.id = weekly_menu_items.weekly_menu_id
      and weekly_menus.published = true
    )
  );

drop policy if exists "Public can read delivery settings" on delivery_settings;
create policy "Public can read delivery settings" on delivery_settings
  for select using (true);

drop policy if exists "Public can read delivery windows for published menus" on delivery_windows;
create policy "Public can read delivery windows for published menus" on delivery_windows
  for select using (
    exists (
      select 1 from weekly_menus
      where weekly_menus.id = delivery_windows.weekly_menu_id
      and weekly_menus.published = true
    )
  );

drop policy if exists "Public can read approved AI knowledge" on ai_knowledge_entries;
create policy "Public can read approved AI knowledge" on ai_knowledge_entries
  for select using (approved = true);

drop policy if exists "Public can read product images" on storage.objects;
create policy "Public can read product images" on storage.objects
  for select using (bucket_id = 'product-images');

-- Bread Club is server-managed. Public enrollment reads go through application
-- routes so capacity, tax gating, and subscription state stay authoritative.
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

create table if not exists bread_club_addon_checkouts (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references bread_club_memberships(id) on delete cascade,
  fulfillment_id uuid not null references bread_club_fulfillments(id) on delete cascade,
  items jsonb not null,
  subtotal_cents integer not null check (subtotal_cents >= 0),
  tax_cents integer not null default 0 check (tax_cents >= 0),
  total_cents integer not null default 0 check (total_cents >= 0),
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

create table if not exists bread_club_sessions (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references bread_club_memberships(id) on delete cascade,
  session_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

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
  claim_token uuid,
  lease_expires_at timestamptz,
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
  claim_token uuid,
  lease_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table email_events
  add column if not exists bread_club_membership_id uuid
  references bread_club_memberships(id) on delete set null;

create index if not exists bread_club_memberships_customer_idx
  on bread_club_memberships(customer_id, created_at desc);
create index if not exists bread_club_memberships_status_idx
  on bread_club_memberships(status);
create index if not exists bread_club_fulfillments_week_idx
  on bread_club_fulfillments(weekly_menu_id, status);
create index if not exists bread_club_rollover_credits_member_idx
  on bread_club_rollover_credits(membership_id, status, expires_at);
create index if not exists bread_club_magic_links_email_idx
  on bread_club_magic_links(email, created_at desc);
create index if not exists bread_club_sessions_member_idx
  on bread_club_sessions(membership_id, expires_at desc);
create index if not exists orders_bread_club_membership_idx
  on orders(bread_club_membership_id, created_at desc);
create index if not exists orders_stripe_invoice_idx
  on orders(stripe_invoice_id);
create index if not exists bread_club_job_events_status_idx
  on bread_club_job_events(status, updated_at desc);

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

drop function if exists complete_bread_club_addon_checkout(uuid, text);

create or replace function complete_bread_club_addon_checkout(
  p_addon_checkout_id uuid,
  p_payment_intent_id text default null,
  p_tax_cents integer default 0,
  p_total_cents integer default null
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
  charged_tax_cents integer := greatest(coalesce(p_tax_cents, 0), 0);
  charged_total_cents integer;
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

  charged_total_cents := coalesce(
    p_total_cents,
    addon_row.subtotal_cents + charged_tax_cents
  );

  if charged_total_cents < addon_row.subtotal_cents then
    raise exception 'The Stripe add-on total is invalid.';
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
      tax_cents = tax_cents + charged_tax_cents,
      total_cents = total_cents + charged_total_cents,
      updated_at = now()
  where id = fulfillment_row.order_id;

  update bread_club_addon_checkouts
  set status = 'paid',
      stripe_payment_intent_id = p_payment_intent_id,
      tax_cents = charged_tax_cents,
      total_cents = charged_total_cents,
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

revoke all on function public.reserve_order_inventory(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.release_order_inventory(uuid)
  from public, anon, authenticated;
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
revoke all on function complete_bread_club_addon_checkout(
  uuid,
  text,
  integer,
  integer
)
  from public, anon, authenticated;
revoke all on function claim_stripe_event(text, text, text)
  from public, anon, authenticated;

grant execute on function public.reserve_order_inventory(uuid, jsonb)
  to service_role;
grant execute on function public.release_order_inventory(uuid)
  to service_role;
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
grant execute on function complete_bread_club_addon_checkout(
  uuid,
  text,
  integer,
  integer
)
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

create table if not exists public.admin_order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  actor_email text check (actor_email is null or char_length(actor_email) <= 320),
  action text not null check (char_length(action) between 1 and 80),
  previous_status order_status,
  next_status order_status,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists admin_order_events_order_created_idx
  on public.admin_order_events(order_id, created_at desc);

alter table public.admin_order_events enable row level security;

create or replace function public.admin_transition_order_status(
  p_order_id uuid,
  p_expected_status order_status,
  p_next_status order_status,
  p_actor_email text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  order_row orders%rowtype;
  transition_allowed boolean := false;
begin
  select *
  into order_row
  from orders
  where id = p_order_id
  for update;

  if order_row.id is null then
    raise exception 'Order could not be found.';
  end if;

  if order_row.status <> p_expected_status then
    return false;
  end if;

  transition_allowed :=
    (order_row.status = 'paid' and p_next_status in ('baking', 'delivered'))
    or (order_row.status = 'baking' and p_next_status in ('out_for_delivery', 'delivered'))
    or (order_row.status = 'out_for_delivery' and p_next_status in ('baking', 'delivered'))
    or (order_row.status = 'delivered' and p_next_status = 'out_for_delivery');

  if not transition_allowed then
    raise exception 'That order transition is not allowed.';
  end if;

  update orders
  set status = p_next_status,
      updated_at = now()
  where id = order_row.id;

  insert into admin_order_events (
    order_id,
    actor_email,
    action,
    previous_status,
    next_status
  )
  values (
    order_row.id,
    nullif(trim(p_actor_email), ''),
    'change_status',
    order_row.status,
    p_next_status
  );

  return true;
end;
$$;

create or replace function public.admin_accept_approval_order(
  p_order_id uuid,
  p_target_delivery_window_id uuid default null,
  p_actor_email text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  order_row orders%rowtype;
  target_window_id uuid;
  current_menu_start timestamptz;
  target_menu_start timestamptz;
  target_starts_at timestamptz;
  target_ends_at timestamptz;
  reservation_items jsonb;
  action_name text;
begin
  select *
  into order_row
  from orders
  where id = p_order_id
  for update;

  if order_row.id is null then
    raise exception 'Order could not be found.';
  end if;
  if order_row.source <> 'storefront' or order_row.status <> 'pending_approval' then
    raise exception 'Only paid storefront approval requests can be accepted.';
  end if;
  if order_row.delivery_window_id is null then
    raise exception 'Order does not have a Sunday delivery time to reserve.';
  end if;

  target_window_id := coalesce(
    p_target_delivery_window_id,
    order_row.delivery_window_id
  );

  if target_window_id <> order_row.delivery_window_id then
    if order_row.next_week_ok is not true then
      raise exception 'Customer did not approve moving this order to next Sunday.';
    end if;

    select weekly_menu.starts_at
    into current_menu_start
    from delivery_windows delivery_window
    join weekly_menus weekly_menu
      on weekly_menu.id = delivery_window.weekly_menu_id
    where delivery_window.id = order_row.delivery_window_id;

    select weekly_menu.starts_at, delivery_window.starts_at, delivery_window.ends_at
    into target_menu_start, target_starts_at, target_ends_at
    from delivery_windows delivery_window
    join weekly_menus weekly_menu
      on weekly_menu.id = delivery_window.weekly_menu_id
    where delivery_window.id = target_window_id
    for update of delivery_window;

    if current_menu_start is null
      or target_menu_start is null
      or target_menu_start <= current_menu_start
    then
      raise exception 'Move target must be a later delivery week.';
    end if;

    if extract(isodow from target_starts_at at time zone 'America/New_York') <> 7
      or (target_starts_at at time zone 'America/New_York')::time <> time '15:00'
      or (target_ends_at at time zone 'America/New_York')::time <> time '18:00'
    then
      raise exception 'Move target must be the Sunday 3:00-6:00 PM delivery slot.';
    end if;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'product_id', product_id,
        'quantity', quantity
      )
    ),
    '[]'::jsonb
  )
  into reservation_items
  from order_items
  where order_id = order_row.id;

  if jsonb_array_length(reservation_items) = 0 then
    raise exception 'Order does not contain any items to reserve.';
  end if;

  perform reserve_order_inventory(target_window_id, reservation_items);

  action_name := case
    when target_window_id = order_row.delivery_window_id
      then 'accept_approval'
    else 'move_approval'
  end;

  update orders
  set delivery_window_id = target_window_id,
      status = 'paid',
      approved_at = now(),
      admin_decision_note = case
        when action_name = 'accept_approval'
          then 'Accepted same-week approval request.'
        else 'Moved approval request to next delivery week.'
      end,
      updated_at = now()
  where id = order_row.id;

  insert into admin_order_events (
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
    action_name,
    order_row.status,
    'paid',
    jsonb_build_object('delivery_window_id', target_window_id)
  );

  return true;
end;
$$;

revoke all on table public.admin_order_events
  from public, anon, authenticated;
revoke all on function public.admin_transition_order_status(
  uuid,
  order_status,
  order_status,
  text
) from public, anon, authenticated;
revoke all on function public.admin_accept_approval_order(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.admin_transition_order_status(
  uuid,
  order_status,
  order_status,
  text
) to service_role;
grant execute on function public.admin_accept_approval_order(uuid, uuid, text)
  to service_role;

-- Lease-fenced event and job claims. A worker whose lease was reclaimed cannot
-- overwrite the result of the newer worker that owns the replacement token.
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
    id, event_type, object_id, status, claim_token, lease_expires_at
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

create or replace function public.cancel_storefront_checkout(
  p_order_id uuid default null,
  p_session_id text default null,
  p_cancel_token text default null,
  p_actor_email text default null,
  p_reason text default 'checkout_canceled'
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  order_row public.orders%rowtype;
begin
  if p_order_id is null and nullif(trim(p_session_id), '') is null then
    raise exception 'Order ID or Stripe Checkout Session ID is required.';
  end if;

  select *
  into order_row
  from public.orders
  where source = 'storefront'
    and (p_order_id is null or id = p_order_id)
    and (p_session_id is null or stripe_checkout_session_id = p_session_id)
    and (p_cancel_token is null or checkout_cancel_token = p_cancel_token)
    and status in ('pending_payment', 'pending_approval_payment')
  order by created_at desc
  limit 1
  for update;

  if order_row.id is null then
    return null;
  end if;

  if order_row.status = 'pending_payment' then
    perform public.release_order_inventory(order_row.id);
  end if;

  update public.orders
  set status = 'canceled',
      admin_decision_note = case
        when nullif(trim(p_reason), '') is null then admin_decision_note
        else left(trim(p_reason), 500)
      end,
      updated_at = now()
  where id = order_row.id;

  insert into public.admin_order_events (
    order_id, actor_email, action, previous_status, next_status, details
  )
  values (
    order_row.id,
    nullif(trim(p_actor_email), ''),
    'cancel_checkout',
    order_row.status,
    'canceled',
    jsonb_build_object('reason', coalesce(nullif(trim(p_reason), ''), 'checkout_canceled'))
  );

  return order_row.id;
end;
$$;

create or replace function public.complete_storefront_checkout_payment(
  p_session_id text,
  p_currency text,
  p_subtotal_cents integer,
  p_tax_cents integer,
  p_total_cents integer
)
returns table (
  order_id uuid,
  next_status public.order_status,
  recovery_note text
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  order_row public.orders%rowtype;
  target_status public.order_status;
  note text := null;
  reservation_items jsonb;
begin
  if lower(coalesce(p_currency, '')) <> 'usd' then
    raise exception 'Checkout currency did not match USD.';
  end if;
  if p_subtotal_cents is null
    or p_subtotal_cents < 0
    or p_tax_cents is null
    or p_tax_cents < 0
    or p_total_cents is null
    or p_total_cents <> p_subtotal_cents + p_tax_cents
  then
    raise exception 'Stripe Checkout totals were invalid.';
  end if;

  select *
  into order_row
  from public.orders
  where stripe_checkout_session_id = p_session_id
    and source = 'storefront'
  for update;

  if order_row.id is null then
    return;
  end if;
  if p_subtotal_cents <> order_row.subtotal_cents + order_row.delivery_fee_cents then
    raise exception 'Stripe Checkout subtotal did not match the order total.';
  end if;

  if order_row.status = 'pending_payment' then
    target_status := 'paid';
  elsif order_row.status = 'pending_approval_payment' then
    target_status := 'pending_approval';
  elsif order_row.status = 'canceled'
    and order_row.refunded_at is null
    and order_row.stripe_refund_id is null
  then
    if order_row.approval_mode = 'after_cutoff' then
      target_status := 'pending_approval';
      note := 'Payment completed after local cancellation; owner review is required.';
    else
      select coalesce(
        jsonb_agg(
          jsonb_build_object('product_id', product_id, 'quantity', quantity)
        ),
        '[]'::jsonb
      )
      into reservation_items
      from public.order_items order_item
      where order_item.order_id = order_row.id;

      if jsonb_array_length(reservation_items) = 0 then
        target_status := 'pending_approval';
        note := 'Payment completed after cancellation, but the order has no items to reserve.';
      else
        begin
          perform public.reserve_order_inventory(
            order_row.delivery_window_id,
            reservation_items
          );
          target_status := 'paid';
          note := 'Payment completed after cancellation; inventory was recovered.';
        exception when others then
          target_status := 'pending_approval';
          note := 'Payment completed after cancellation, but inventory could not be recovered: '
            || sqlerrm;
        end;
      end if;
    end if;
  else
    return query select order_row.id, order_row.status, null::text;
    return;
  end if;

  update public.orders
  set status = target_status,
      tax_cents = p_tax_cents,
      total_cents = p_total_cents,
      paid_at = coalesce(paid_at, now()),
      admin_decision_note = coalesce(note, admin_decision_note),
      updated_at = now()
  where id = order_row.id;

  if order_row.status = 'canceled' then
    insert into public.admin_order_events (
      order_id, action, previous_status, next_status, details
    )
    values (
      order_row.id,
      'recover_paid_checkout',
      order_row.status,
      target_status,
      jsonb_build_object(
        'stripe_checkout_session_id', p_session_id,
        'note', note
      )
    );
  end if;

  return query select order_row.id, target_status, note;
end;
$$;

revoke all on function public.cancel_storefront_checkout(uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.complete_storefront_checkout_payment(text, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.cancel_storefront_checkout(uuid, text, text, text, text)
  to service_role;
grant execute on function public.complete_storefront_checkout_payment(text, text, integer, integer, integer)
  to service_role;

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
      job_key, order_id, notification_type
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

create table if not exists public.admin_configuration_events (
  id uuid primary key default gen_random_uuid(),
  actor_email text check (actor_email is null or char_length(actor_email) <= 320),
  action text not null check (char_length(action) between 1 and 80),
  weekly_menu_id uuid references public.weekly_menus(id) on delete set null,
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists admin_configuration_events_created_idx
  on public.admin_configuration_events(created_at desc);

alter table public.admin_configuration_events enable row level security;

do $$
begin
  if exists (
    select 1
    from public.delivery_windows delivery_window
    group by delivery_window.weekly_menu_id
    having count(*) > 1
  ) then
    raise exception 'Multiple delivery slots exist for one weekly menu. Resolve them before applying the one-slot invariant.';
  end if;
end;
$$;

create unique index if not exists delivery_windows_weekly_menu_unique_idx
  on public.delivery_windows(weekly_menu_id);

create or replace function public.admin_save_weekly_menu(
  p_weekly_menu_id uuid,
  p_name text,
  p_order_cutoff_at timestamptz,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_published boolean,
  p_items jsonb,
  p_actor_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_menu_id uuid := p_weekly_menu_id;
  v_item jsonb;
  v_product_id uuid;
  v_available_quantity integer;
  v_sold_quantity integer;
  v_unavailable boolean;
  v_auto_generated boolean := false;
  v_existing_order_cutoff_at timestamptz;
  v_existing_starts_at timestamptz;
  v_existing_ends_at timestamptz;
begin
  if char_length(trim(coalesce(p_name, ''))) not between 2 and 120 then
    raise exception 'Weekly menu name is invalid.';
  end if;
  if p_starts_at is null
    or p_ends_at is null
    or p_order_cutoff_at is null
    or p_starts_at >= p_ends_at
    or p_order_cutoff_at >= p_ends_at
  then
    raise exception 'Weekly menu dates are invalid.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Weekly menu items must be an array.';
  end if;
  if p_published is null then
    raise exception 'Weekly menu publication state is required.';
  end if;
  if jsonb_array_length(p_items) > 250 then
    raise exception 'Weekly menus can contain at most 250 products.';
  end if;
  if p_published and jsonb_array_length(p_items) = 0 then
    raise exception 'Published weekly menus need at least one product.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) as items(item)
    group by (item ->> 'product_id')::uuid
    having count(*) > 1
  ) then
    raise exception 'A product can appear only once in a weekly menu.';
  end if;

  if v_menu_id is null then
    insert into public.weekly_menus (
      name, order_cutoff_at, starts_at, ends_at, published
    )
    values (
      trim(p_name), p_order_cutoff_at, p_starts_at, p_ends_at, p_published
    )
    returning id into v_menu_id;
  else
    select
      weekly_menu.auto_generated,
      weekly_menu.order_cutoff_at,
      weekly_menu.starts_at,
      weekly_menu.ends_at
    into
      v_auto_generated,
      v_existing_order_cutoff_at,
      v_existing_starts_at,
      v_existing_ends_at
    from public.weekly_menus weekly_menu
    where weekly_menu.id = v_menu_id
    for update;
    if not found then
      raise exception 'Weekly menu could not be found.';
    end if;
    if v_auto_generated and (
      v_existing_order_cutoff_at is distinct from p_order_cutoff_at
      or v_existing_starts_at is distinct from p_starts_at
      or v_existing_ends_at is distinct from p_ends_at
    ) then
      raise exception 'Auto-generated weekly menu dates are managed by the rolling schedule.';
    end if;

    update public.weekly_menus
    set name = trim(p_name),
        order_cutoff_at = p_order_cutoff_at,
        starts_at = p_starts_at,
        ends_at = p_ends_at,
        published = p_published
    where id = v_menu_id;
  end if;

  -- All configuration commands acquire weekly-menu locks before product locks.
  -- This matches admin_save_product and prevents cross-editor deadlocks.
  perform product.id
  from public.products product
  where product.id in (
    select (entry ->> 'product_id')::uuid
    from jsonb_array_elements(p_items) entry
  )
  order by product.id
  for key share;

  -- Inventory reservations update these same rows. Locking them before the
  -- sold-quantity checks prevents a checkout from racing a menu deletion or
  -- capacity reduction.
  perform menu_item.id
  from public.weekly_menu_items menu_item
  where menu_item.weekly_menu_id = v_menu_id
  order by menu_item.product_id
  for update;

  if exists (
    select 1
    from public.delivery_windows delivery_window
    where delivery_window.weekly_menu_id = v_menu_id
      and (
        delivery_window.starts_at < p_starts_at
        or delivery_window.ends_at > p_ends_at
      )
  ) then
    raise exception 'Weekly menu dates must contain its Sunday delivery slot.';
  end if;

  if exists (
    select 1
    from public.weekly_menu_items menu_item
    where menu_item.weekly_menu_id = v_menu_id
      and menu_item.sold_quantity > 0
      and not exists (
        select 1
        from jsonb_array_elements(p_items) entry
        where (entry ->> 'product_id')::uuid = menu_item.product_id
      )
  ) then
    raise exception 'A product with paid or reserved orders cannot be removed from this week.';
  end if;

  delete from public.weekly_menu_items menu_item
  where menu_item.weekly_menu_id = v_menu_id
    and not exists (
      select 1
      from jsonb_array_elements(p_items) entry
      where (entry ->> 'product_id')::uuid = menu_item.product_id
    );

  for v_item in
    select item
    from jsonb_array_elements(p_items) as items(item)
    order by (item ->> 'product_id')::uuid
  loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_available_quantity := (v_item ->> 'available_quantity')::integer;
    v_unavailable := coalesce((v_item ->> 'unavailable')::boolean, false);
    if v_product_id is null then
      raise exception 'Every weekly menu item needs a product.';
    end if;
    if v_available_quantity is null
      or v_available_quantity < 0
      or v_available_quantity > 1000
    then
      raise exception 'Weekly menu inventory must be zero or greater.';
    end if;
    if v_available_quantity = 0 and not v_unavailable then
      raise exception 'Zero-inventory products must be marked unavailable.';
    end if;

    perform 1
    from public.products product
    where product.id = v_product_id;
    if not found then
      raise exception 'A weekly menu product could not be found.';
    end if;

    select menu_item.sold_quantity
    into v_sold_quantity
    from public.weekly_menu_items menu_item
    where menu_item.weekly_menu_id = v_menu_id
      and menu_item.product_id = v_product_id
    for update;
    if v_sold_quantity is not null
      and v_sold_quantity > v_available_quantity
    then
      raise exception 'Inventory cannot be lower than the quantity already sold.';
    end if;

    insert into public.weekly_menu_items (
      weekly_menu_id,
      product_id,
      available_quantity,
      featured,
      unavailable
    )
    values (
      v_menu_id,
      v_product_id,
      v_available_quantity,
      coalesce((v_item ->> 'featured')::boolean, false)
        and not v_unavailable,
      v_unavailable
    )
    on conflict (weekly_menu_id, product_id)
    do update set
      available_quantity = excluded.available_quantity,
      featured = excluded.featured,
      unavailable = excluded.unavailable;
  end loop;

  insert into public.admin_configuration_events (
    actor_email, action, weekly_menu_id, details
  )
  values (
    nullif(trim(p_actor_email), ''),
    'save_weekly_menu',
    v_menu_id,
    jsonb_build_object(
      'name', trim(p_name),
      'published', p_published,
      'item_count', jsonb_array_length(p_items)
    )
  );

  return v_menu_id;
end;
$$;

create or replace function public.admin_set_weekly_menu_item_availability(
  p_weekly_menu_id uuid,
  p_product_id uuid,
  p_unavailable boolean,
  p_actor_email text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_available_quantity integer;
begin
  if p_unavailable is null then
    raise exception 'Product availability state is required.';
  end if;

  select menu_item.available_quantity
  into v_available_quantity
  from public.weekly_menu_items menu_item
  where menu_item.weekly_menu_id = p_weekly_menu_id
    and menu_item.product_id = p_product_id
  for update;

  if not found then
    return false;
  end if;
  if not p_unavailable and v_available_quantity = 0 then
    raise exception 'Add inventory before making this product available.';
  end if;

  update public.weekly_menu_items menu_item
  set unavailable = p_unavailable,
      featured = case when p_unavailable then false else menu_item.featured end
  where menu_item.weekly_menu_id = p_weekly_menu_id
    and menu_item.product_id = p_product_id;

  insert into public.admin_configuration_events (
    actor_email, action, weekly_menu_id, details
  )
  values (
    nullif(trim(p_actor_email), ''),
    'set_weekly_menu_item_availability',
    p_weekly_menu_id,
    jsonb_build_object(
      'product_id', p_product_id,
      'unavailable', p_unavailable
    )
  );

  return true;
end;
$$;

create or replace function public.admin_save_delivery_configuration(
  p_weekly_menu_id uuid,
  p_settings jsonb,
  p_windows jsonb,
  p_actor_email text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_window_item jsonb;
  v_window_id uuid;
  v_window_capacity integer;
  v_window_reserved integer;
  v_current_window_label text;
  v_current_window_starts_at timestamptz;
  v_current_window_ends_at timestamptz;
  v_active_window_count integer;
  v_window_label text;
  v_window_starts_at timestamptz;
  v_window_ends_at timestamptz;
  v_menu_starts_at timestamptz;
  v_menu_ends_at timestamptz;
  v_center_lat numeric;
  v_center_lng numeric;
  v_radius_miles numeric;
  v_delivery_fee_cents integer;
  v_allowed_postal_codes text[];
  v_service_area_copy text;
begin
  select weekly_menu.starts_at, weekly_menu.ends_at
  into v_menu_starts_at, v_menu_ends_at
  from public.weekly_menus weekly_menu
  where weekly_menu.id = p_weekly_menu_id
  for update;
  if not found then
    raise exception 'Weekly menu could not be found.';
  end if;
  if p_settings is null
    or p_windows is null
    or jsonb_typeof(p_settings) <> 'object'
    or jsonb_typeof(p_windows) <> 'array'
  then
    raise exception 'Delivery configuration payload is invalid.';
  end if;
  if jsonb_array_length(p_windows) > 100 then
    raise exception 'Delivery configuration contains too many slots.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_windows) as windows(window_item)
    where nullif(window_item ->> 'id', '') is not null
    group by (window_item ->> 'id')::uuid
    having count(*) > 1
  ) then
    raise exception 'A Sunday delivery slot can appear only once.';
  end if;

  select count(*)::integer
  into v_active_window_count
  from jsonb_array_elements(p_windows) entry
  where not coalesce((entry ->> 'remove')::boolean, false);
  if v_active_window_count > 1 then
    raise exception 'Each bake week can have one Sunday delivery slot.';
  end if;

  v_center_lat := (p_settings ->> 'center_lat')::numeric;
  v_center_lng := (p_settings ->> 'center_lng')::numeric;
  v_radius_miles := (p_settings ->> 'radius_miles')::numeric;
  v_delivery_fee_cents := (p_settings ->> 'delivery_fee_cents')::integer;
  v_service_area_copy := trim(coalesce(p_settings ->> 'service_area_copy', ''));
  if v_center_lat is null or v_center_lat not between -90 and 90
    or v_center_lng is null or v_center_lng not between -180 and 180
    or v_radius_miles is null or v_radius_miles not between 0 and 100
    or v_delivery_fee_cents is null
    or v_delivery_fee_cents not between 0 and 50000
    or char_length(v_service_area_copy) not between 10 and 500
  then
    raise exception 'Delivery settings are outside their allowed range.';
  end if;
  if jsonb_typeof(p_settings -> 'allowed_postal_codes') <> 'array' then
    raise exception 'Delivery ZIP codes must be an array.';
  end if;
  select array_agg(postal_code order by ordinal_position)
  into v_allowed_postal_codes
  from jsonb_array_elements_text(
    p_settings -> 'allowed_postal_codes'
  ) with ordinality as postal_codes(postal_code, ordinal_position);
  if coalesce(cardinality(v_allowed_postal_codes), 0) = 0
    or exists (
      select 1
      from unnest(v_allowed_postal_codes) as postal_codes(postal_code)
      where postal_code !~ '^[0-9]{5}$'
    )
    or cardinality(v_allowed_postal_codes) <> (
      select count(distinct postal_code)
      from unnest(v_allowed_postal_codes) as postal_codes(postal_code)
    )
  then
    raise exception 'Delivery ZIP codes must be unique 5-digit ZIP codes.';
  end if;

  insert into public.delivery_settings (
    id,
    center_lat,
    center_lng,
    radius_miles,
    delivery_fee_cents,
    allowed_postal_codes,
    service_area_copy
  )
  values (
    true,
    v_center_lat,
    v_center_lng,
    v_radius_miles,
    v_delivery_fee_cents,
    v_allowed_postal_codes,
    v_service_area_copy
  )
  on conflict (id)
  do update set
    center_lat = excluded.center_lat,
    center_lng = excluded.center_lng,
    radius_miles = excluded.radius_miles,
    delivery_fee_cents = excluded.delivery_fee_cents,
    allowed_postal_codes = excluded.allowed_postal_codes,
    service_area_copy = excluded.service_area_copy;

  for v_window_item in select * from jsonb_array_elements(p_windows)
  loop
    v_window_id := nullif(v_window_item ->> 'id', '')::uuid;
    if coalesce((v_window_item ->> 'remove')::boolean, false) then
      if v_window_id is null then
        raise exception 'A Sunday delivery slot needs an identifier before it can be removed.';
      end if;
      select delivery_window.reserved
      into v_window_reserved
      from public.delivery_windows delivery_window
      where delivery_window.id = v_window_id
        and delivery_window.weekly_menu_id = p_weekly_menu_id
      for update;
      if v_window_reserved is null then
        raise exception 'Sunday delivery slot could not be found.';
      end if;
      if v_window_reserved > 0 then
        raise exception 'A Sunday time with reserved orders cannot be removed.';
      end if;
      if exists (
        select 1
        from public.orders order_record
        where order_record.delivery_window_id = v_window_id
      ) or exists (
        select 1
        from public.bread_club_fulfillments fulfillment
        where fulfillment.delivery_window_id = v_window_id
      ) then
        raise exception 'A Sunday time with order history cannot be removed. Keep the slot for historical records.';
      end if;
      delete from public.delivery_windows delivery_window
      where delivery_window.id = v_window_id
        and delivery_window.weekly_menu_id = p_weekly_menu_id;
      continue;
    end if;

    v_window_label := trim(coalesce(v_window_item ->> 'label', ''));
    v_window_starts_at := (v_window_item ->> 'starts_at')::timestamptz;
    v_window_ends_at := (v_window_item ->> 'ends_at')::timestamptz;
    v_window_capacity := (v_window_item ->> 'capacity')::integer;
    if char_length(v_window_label) not between 2 and 120
      or v_window_starts_at is null
      or v_window_ends_at is null
      or v_window_starts_at >= v_window_ends_at
      or v_window_starts_at < v_menu_starts_at
      or v_window_ends_at > v_menu_ends_at
      or extract(isodow from v_window_starts_at at time zone 'America/New_York') <> 7
      or (v_window_starts_at at time zone 'America/New_York')::date
        <> (v_window_ends_at at time zone 'America/New_York')::date
      or extract(hour from v_window_starts_at at time zone 'America/New_York') <> 15
      or extract(minute from v_window_starts_at at time zone 'America/New_York') <> 0
      or extract(hour from v_window_ends_at at time zone 'America/New_York') <> 18
      or extract(minute from v_window_ends_at at time zone 'America/New_York') <> 0
    then
      raise exception 'Sunday delivery slot dates or label are invalid.';
    end if;
    if v_window_capacity is null
      or v_window_capacity < 0
      or v_window_capacity > 1000
    then
      raise exception 'Sunday delivery capacity must be zero or greater.';
    end if;

    if v_window_id is null then
      insert into public.delivery_windows (
        weekly_menu_id, label, starts_at, ends_at, capacity
      )
      values (
        p_weekly_menu_id,
        v_window_label,
        v_window_starts_at,
        v_window_ends_at,
        v_window_capacity
      );
    else
      select
        delivery_window.reserved,
        delivery_window.label,
        delivery_window.starts_at,
        delivery_window.ends_at
      into
        v_window_reserved,
        v_current_window_label,
        v_current_window_starts_at,
        v_current_window_ends_at
      from public.delivery_windows delivery_window
      where delivery_window.id = v_window_id
        and delivery_window.weekly_menu_id = p_weekly_menu_id
      for update;
      if v_window_reserved is null then
        raise exception 'Sunday delivery slot could not be found.';
      end if;
      if v_window_capacity < v_window_reserved then
        raise exception 'Capacity cannot be lower than the number of reserved orders.';
      end if;
      if v_window_reserved > 0 and (
        v_current_window_label is distinct from v_window_label
        or v_current_window_starts_at is distinct from v_window_starts_at
        or v_current_window_ends_at is distinct from v_window_ends_at
      ) then
        raise exception 'A Sunday time with reserved orders cannot be rescheduled or relabeled.';
      end if;

      update public.delivery_windows delivery_window
      set label = v_window_label,
          starts_at = v_window_starts_at,
          ends_at = v_window_ends_at,
          capacity = v_window_capacity
      where delivery_window.id = v_window_id
        and delivery_window.weekly_menu_id = p_weekly_menu_id;
    end if;
  end loop;

  select count(*)::integer
  into v_active_window_count
  from public.delivery_windows delivery_window
  where delivery_window.weekly_menu_id = p_weekly_menu_id;
  if v_active_window_count > 1 then
    raise exception 'Each bake week can have one Sunday delivery slot.';
  end if;

  insert into public.admin_configuration_events (
    actor_email, action, weekly_menu_id, details
  )
  values (
    nullif(trim(p_actor_email), ''),
    'save_delivery_configuration',
    p_weekly_menu_id,
    jsonb_build_object('window_count', v_active_window_count)
  );

  return true;
end;
$$;

revoke all on table public.admin_configuration_events
  from public, anon, authenticated;
revoke all on function public.admin_save_weekly_menu(uuid, text, timestamptz, timestamptz, timestamptz, boolean, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.admin_set_weekly_menu_item_availability(uuid, uuid, boolean, text)
  from public, anon, authenticated;
revoke all on function public.admin_save_delivery_configuration(uuid, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.admin_save_weekly_menu(uuid, text, timestamptz, timestamptz, timestamptz, boolean, jsonb, text)
  to service_role;
grant execute on function public.admin_set_weekly_menu_item_availability(uuid, uuid, boolean, text)
  to service_role;
grant execute on function public.admin_save_delivery_configuration(uuid, jsonb, jsonb, text)
  to service_role;

create or replace function public.admin_save_product(
  p_product_id uuid,
  p_name text,
  p_slug text,
  p_category public.product_category,
  p_description text,
  p_ingredients text[],
  p_allergens text[],
  p_price_cents integer,
  p_estimated_ingredient_cost_cents integer,
  p_image_url text,
  p_image_style text,
  p_active boolean,
  p_include_in_menus boolean,
  p_weekly_menu_ids uuid[],
  p_weekly_quantity integer,
  p_featured boolean,
  p_actor_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_product_id uuid := p_product_id;
  v_existing_price_cents integer;
  v_menu_ids uuid[] := coalesce(p_weekly_menu_ids, '{}'::uuid[]);
begin
  if char_length(trim(coalesce(p_name, ''))) not between 2 and 120
    or char_length(trim(coalesce(p_slug, ''))) not between 1 and 80
    or char_length(trim(coalesce(p_description, ''))) not between 10 and 800
    or char_length(trim(coalesce(p_image_style, ''))) not between 3 and 160
    or coalesce(cardinality(p_ingredients), 0) = 0
    or exists (
      select 1
      from unnest(p_ingredients) as ingredients(ingredient)
      where nullif(trim(ingredient), '') is null
    )
    or exists (
      select 1
      from unnest(coalesce(p_allergens, '{}'::text[])) as allergens(allergen)
      where nullif(trim(allergen), '') is null
    )
    or p_category is null
    or p_price_cents is null
    or p_price_cents not between 0 and 50000
    or (
      p_estimated_ingredient_cost_cents is not null
      and p_estimated_ingredient_cost_cents not between 0 and 50000
    )
    or p_active is null
    or p_include_in_menus is null
    or p_featured is null
  then
    raise exception 'Product configuration is invalid.';
  end if;
  if p_weekly_quantity is null or p_weekly_quantity not between 0 and 1000 then
    raise exception 'Weekly product inventory is invalid.';
  end if;
  if p_include_in_menus
    and cardinality(v_menu_ids) > 0
    and p_weekly_quantity = 0
  then
    raise exception 'Add weekly inventory before including this product in menus.';
  end if;
  if cardinality(v_menu_ids) <> (
    select count(distinct weekly_menu_id)
    from unnest(v_menu_ids) as menu_ids(weekly_menu_id)
  ) then
    raise exception 'A weekly menu can appear only once in the product command.';
  end if;
  if p_include_in_menus and cardinality(v_menu_ids) > 0 then
    -- Match admin_save_weekly_menu's lock order: menu first, then product.
    -- Sorting also keeps multi-menu product saves deterministic.
    perform weekly_menu.id
    from public.weekly_menus weekly_menu
    where weekly_menu.id = any(v_menu_ids)
    order by weekly_menu.id
    for update;

    if (
      select count(*)
      from public.weekly_menus weekly_menu
      where weekly_menu.id = any(v_menu_ids)
        and weekly_menu.published = true
        and weekly_menu.ends_at >= now()
    ) <> cardinality(v_menu_ids) then
      raise exception 'An upcoming published weekly menu could not be found.';
    end if;
  end if;

  if v_product_id is null then
    insert into public.products (
      name,
      slug,
      category,
      description,
      ingredients,
      allergens,
      price_cents,
      estimated_ingredient_cost_cents,
      image_url,
      image_style,
      active,
      updated_at
    )
    values (
      trim(p_name),
      trim(p_slug),
      p_category,
      trim(p_description),
      p_ingredients,
      coalesce(p_allergens, '{}'::text[]),
      p_price_cents,
      p_estimated_ingredient_cost_cents,
      nullif(trim(p_image_url), ''),
      trim(p_image_style),
      p_active,
      now()
    )
    returning id into v_product_id;
  else
    select product.price_cents
    into v_existing_price_cents
    from public.products product
    where product.id = v_product_id
    for update;
    if not found then
      raise exception 'Product could not be found.';
    end if;

    update public.products product
    set name = trim(p_name),
        slug = trim(p_slug),
        category = p_category,
        description = trim(p_description),
        ingredients = p_ingredients,
        allergens = coalesce(p_allergens, '{}'::text[]),
        price_cents = p_price_cents,
        estimated_ingredient_cost_cents = p_estimated_ingredient_cost_cents,
        image_url = nullif(trim(p_image_url), ''),
        image_style = trim(p_image_style),
        active = p_active,
        stripe_price_id = case
          when v_existing_price_cents is distinct from p_price_cents then null
          else product.stripe_price_id
        end,
        stripe_price_cents = case
          when v_existing_price_cents is distinct from p_price_cents then null
          else product.stripe_price_cents
        end,
        stripe_synced_at = case
          when v_existing_price_cents is distinct from p_price_cents then null
          else product.stripe_synced_at
        end,
        updated_at = now()
    where product.id = v_product_id;
  end if;

  if p_include_in_menus and cardinality(v_menu_ids) > 0 then
    insert into public.weekly_menu_items (
      weekly_menu_id,
      product_id,
      available_quantity,
      sold_quantity,
      featured,
      unavailable
    )
    select
      weekly_menu_id,
      v_product_id,
      p_weekly_quantity,
      0,
      p_featured,
      false
    from unnest(v_menu_ids) as menu_ids(weekly_menu_id)
    on conflict (weekly_menu_id, product_id) do nothing;
  end if;

  insert into public.admin_configuration_events (
    actor_email, action, details
  )
  values (
    nullif(trim(p_actor_email), ''),
    'save_product',
    jsonb_build_object(
      'product_id', v_product_id,
      'name', trim(p_name),
      'active', p_active,
      'attached_menu_count', case
        when p_include_in_menus then cardinality(v_menu_ids)
        else 0
      end
    )
  );

  return v_product_id;
end;
$$;

revoke all on function public.admin_save_product(
  uuid,
  text,
  text,
  public.product_category,
  text,
  text[],
  text[],
  integer,
  integer,
  text,
  text,
  boolean,
  boolean,
  uuid[],
  integer,
  boolean,
  text
) from public, anon, authenticated;

grant execute on function public.admin_save_product(
  uuid,
  text,
  text,
  public.product_category,
  text,
  text[],
  text[],
  integer,
  integer,
  text,
  text,
  boolean,
  boolean,
  uuid[],
  integer,
  boolean,
  text
) to service_role;

alter table public.orders
  add column if not exists checkout_attempt_id uuid,
  add column if not exists checkout_request_hash text,
  add column if not exists checkout_expires_at timestamptz;

create unique index if not exists orders_checkout_attempt_id_unique_idx
  on public.orders(checkout_attempt_id)
  where checkout_attempt_id is not null;

create or replace function public.create_storefront_checkout_order(
  p_checkout_attempt_id uuid,
  p_checkout_request_hash text,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_delivery_window_id uuid,
  p_approval_mode text,
  p_delivery_address jsonb,
  p_delivery_miles numeric,
  p_delivery_instructions text,
  p_delivery_check jsonb,
  p_delivery_fee_cents integer,
  p_notes text,
  p_next_week_ok boolean,
  p_checkout_cancel_token text,
  p_items jsonb,
  p_reserve_inventory boolean
)
returns table (
  order_id uuid,
  customer_id uuid,
  subtotal_cents integer,
  delivery_fee_cents integer,
  total_cents integer,
  checkout_cancel_token text,
  checkout_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_customer_id uuid;
  v_order_id uuid;
  v_weekly_menu_id uuid;
  v_order_cutoff_at timestamptz;
  v_customer_email text := lower(trim(coalesce(p_customer_email, '')));
  v_subtotal_cents integer := 0;
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_unit_price_cents integer;
  v_current_price_cents integer;
  v_available_quantity integer;
  v_sold_quantity integer;
  v_existing_order public.orders%rowtype;
  v_requested_items jsonb;
  v_existing_items jsonb;
  v_checkout_expires_at timestamptz := now() + interval '1 hour';
begin
  if p_checkout_attempt_id is null
    or nullif(trim(coalesce(p_checkout_request_hash, '')), '') is null
    or p_checkout_request_hash !~ '^[0-9a-f]{64}$'
    or char_length(trim(coalesce(p_customer_name, ''))) not between 2 and 120
    or char_length(v_customer_email) not between 3 and 320
    or position('@' in v_customer_email) <= 1
    or char_length(coalesce(p_customer_phone, '')) > 40
    or p_approval_mode not in ('standard', 'after_cutoff')
    or p_delivery_address is null
    or jsonb_typeof(p_delivery_address) <> 'object'
    or p_delivery_check is null
    or jsonb_typeof(p_delivery_check) <> 'object'
    or p_delivery_fee_cents is null
    or p_delivery_fee_cents not between 0 and 50000
    or p_delivery_miles is null
    or p_delivery_miles < 0
    or p_delivery_miles > 500
    or p_reserve_inventory is null
    or nullif(trim(coalesce(p_checkout_cancel_token, '')), '') is null
    or p_checkout_cancel_token !~ '^[0-9a-f]{48}$'
    or char_length(coalesce(p_delivery_instructions, '')) > 1000
    or char_length(coalesce(p_notes, '')) > 1000
  then
    raise exception 'Checkout order details are invalid.';
  end if;
  if trim(coalesce(p_delivery_address ->> 'name', '')) <> trim(p_customer_name)
    or lower(trim(coalesce(p_delivery_address ->> 'email', ''))) <> v_customer_email
    or trim(coalesce(p_delivery_address ->> 'phone', '')) <> trim(p_customer_phone)
    or char_length(trim(coalesce(p_delivery_address ->> 'line1', ''))) not between 3 and 180
    or char_length(trim(coalesce(p_delivery_address ->> 'line2', ''))) > 120
    or char_length(trim(coalesce(p_delivery_address ->> 'city', ''))) not between 1 and 100
    or upper(trim(coalesce(p_delivery_address ->> 'state', ''))) not in ('GA', 'GEORGIA')
    or trim(coalesce(p_delivery_address ->> 'postalCode', '')) !~ '^[0-9]{5}$'
    or coalesce(p_delivery_check -> 'eligible', 'false'::jsonb) <> 'true'::jsonb
    or coalesce((p_delivery_check ->> 'feeCents')::integer, -1) <> p_delivery_fee_cents
    or char_length(
      pg_catalog.regexp_replace(coalesce(p_customer_phone, ''), '[^0-9]', '', 'g')
    ) not between 7 and 20
  then
    raise exception 'Checkout delivery details are invalid.';
  end if;
  if (p_approval_mode = 'standard' and not p_reserve_inventory)
    or (p_approval_mode = 'after_cutoff' and p_reserve_inventory)
    or (p_approval_mode = 'after_cutoff' and p_next_week_ok is null)
  then
    raise exception 'Checkout approval and reservation state do not match.';
  end if;
  if p_items is null
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) not between 1 and 50
  then
    raise exception 'Checkout needs between 1 and 50 items.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) as items(item)
    group by (item ->> 'product_id')::uuid
    having count(*) > 1
  ) then
    raise exception 'A checkout product can appear only once.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'product_id', (item ->> 'product_id')::uuid,
        'quantity', (item ->> 'quantity')::integer,
        'unit_price_cents', (item ->> 'unit_price_cents')::integer
      )
      order by (item ->> 'product_id')::uuid
    ),
    '[]'::jsonb
  )
  into v_requested_items
  from jsonb_array_elements(p_items) as items(item);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'storefront-checkout-attempt:' || p_checkout_attempt_id::text,
      0
    )
  );
  select *
  into v_existing_order
  from public.orders order_record
  where order_record.checkout_attempt_id = p_checkout_attempt_id
  for update;
  if v_existing_order.id is not null then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'product_id', order_item.product_id,
          'quantity', order_item.quantity,
          'unit_price_cents', order_item.unit_price_cents
        )
        order by order_item.product_id
      ),
      '[]'::jsonb
    )
    into v_existing_items
    from public.order_items order_item
    where order_item.order_id = v_existing_order.id;

    if v_existing_order.source <> 'storefront'
      or v_existing_order.checkout_request_hash is distinct from p_checkout_request_hash
      or v_existing_order.delivery_window_id is distinct from p_delivery_window_id
      or v_existing_order.approval_mode is distinct from p_approval_mode
      or v_existing_order.delivery_address is distinct from p_delivery_address
      or v_existing_order.delivery_fee_cents is distinct from p_delivery_fee_cents
      or v_existing_order.delivery_instructions is distinct from nullif(trim(p_delivery_instructions), '')
      or v_existing_order.notes is distinct from nullif(trim(p_notes), '')
      or v_existing_order.next_week_ok is distinct from (
        case when p_approval_mode = 'after_cutoff' then p_next_week_ok else null end
      )
      or v_existing_items is distinct from v_requested_items
    then
      raise exception 'Checkout attempt was already used with different order details.';
    end if;

    return query
    select
      v_existing_order.id,
      v_existing_order.customer_id,
      v_existing_order.subtotal_cents,
      v_existing_order.delivery_fee_cents,
      v_existing_order.total_cents,
      v_existing_order.checkout_cancel_token,
      v_existing_order.checkout_expires_at;
    return;
  end if;

  select delivery_window.weekly_menu_id
  into v_weekly_menu_id
  from public.delivery_windows delivery_window
  where delivery_window.id = p_delivery_window_id;
  if v_weekly_menu_id is null then
    raise exception 'Delivery window is no longer available.';
  end if;

  select weekly_menu.order_cutoff_at
  into v_order_cutoff_at
  from public.weekly_menus weekly_menu
  where weekly_menu.id = v_weekly_menu_id
    and weekly_menu.published = true
  for share;
  if not found then
    raise exception 'Delivery window is no longer available.';
  end if;

  perform 1
  from public.delivery_windows delivery_window
  where delivery_window.id = p_delivery_window_id
    and delivery_window.weekly_menu_id = v_weekly_menu_id
    and delivery_window.ends_at > now()
    and extract(isodow from delivery_window.starts_at at time zone 'America/New_York') = 7
    and extract(hour from delivery_window.starts_at at time zone 'America/New_York') = 15
    and extract(minute from delivery_window.starts_at at time zone 'America/New_York') = 0
    and (delivery_window.starts_at at time zone 'America/New_York')::date
      = (delivery_window.ends_at at time zone 'America/New_York')::date
    and extract(isodow from delivery_window.ends_at at time zone 'America/New_York') = 7
    and extract(hour from delivery_window.ends_at at time zone 'America/New_York') = 18
    and extract(minute from delivery_window.ends_at at time zone 'America/New_York') = 0
  for update;
  if not found then
    raise exception 'Delivery window is no longer available.';
  end if;
  if (p_approval_mode = 'standard' and now() >= v_order_cutoff_at)
    or (p_approval_mode = 'after_cutoff' and now() < v_order_cutoff_at)
  then
    raise exception 'Checkout approval mode no longer matches the weekly cutoff.';
  end if;

  for v_item in
    select item
    from jsonb_array_elements(p_items) as items(item)
    order by (item ->> 'product_id')::uuid
  loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;
    v_unit_price_cents := (v_item ->> 'unit_price_cents')::integer;
    if v_product_id is null
      or v_quantity is null
      or v_quantity not between 1 and 100
      or v_unit_price_cents is null
      or v_unit_price_cents not between 0 and 50000
    then
      raise exception 'Checkout item details are invalid.';
    end if;

    select
      product.price_cents,
      menu_item.available_quantity,
      menu_item.sold_quantity
    into
      v_current_price_cents,
      v_available_quantity,
      v_sold_quantity
    from public.products product
    join public.weekly_menu_items menu_item
      on menu_item.product_id = product.id
      and menu_item.weekly_menu_id = v_weekly_menu_id
    where product.id = v_product_id
      and product.active = true
      and menu_item.unavailable = false
    for key share of product
    for update of menu_item;
    if not found then
      raise exception 'One checkout product is no longer available.';
    end if;
    if v_current_price_cents <> v_unit_price_cents then
      raise exception 'One checkout product price changed. Refresh and try again.';
    end if;
    if v_sold_quantity + v_quantity > v_available_quantity then
      raise exception 'One checkout product does not have enough inventory left.';
    end if;

    v_subtotal_cents := v_subtotal_cents + v_unit_price_cents * v_quantity;
    if v_subtotal_cents > 1000000 then
      raise exception 'Checkout subtotal is outside the allowed range.';
    end if;
  end loop;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('storefront-customer:' || v_customer_email, 0)
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

  insert into public.orders (
    customer_id,
    delivery_window_id,
    source,
    status,
    subtotal_cents,
    delivery_fee_cents,
    tax_cents,
    total_cents,
    delivery_address,
    delivery_miles,
    delivery_instructions,
    delivery_check,
    notes,
    next_week_ok,
    approval_mode,
    checkout_cancel_token,
    checkout_attempt_id,
    checkout_request_hash,
    checkout_expires_at
  )
  values (
    v_customer_id,
    p_delivery_window_id,
    'storefront',
    case
      when p_approval_mode = 'after_cutoff'
        then 'pending_approval_payment'::public.order_status
      else 'pending_payment'::public.order_status
    end,
    v_subtotal_cents,
    p_delivery_fee_cents,
    0,
    v_subtotal_cents + p_delivery_fee_cents,
    p_delivery_address,
    p_delivery_miles,
    nullif(trim(p_delivery_instructions), ''),
    p_delivery_check,
    nullif(trim(p_notes), ''),
    case when p_approval_mode = 'after_cutoff' then p_next_week_ok else null end,
    p_approval_mode,
    p_checkout_cancel_token,
    p_checkout_attempt_id,
    p_checkout_request_hash,
    v_checkout_expires_at
  )
  returning id into v_order_id;

  insert into public.order_items (
    order_id, product_id, quantity, unit_price_cents
  )
  select
    v_order_id,
    (item ->> 'product_id')::uuid,
    (item ->> 'quantity')::integer,
    (item ->> 'unit_price_cents')::integer
  from jsonb_array_elements(p_items) as items(item);

  if p_reserve_inventory then
    perform public.reserve_order_inventory(p_delivery_window_id, p_items);
  end if;

  return query
  select
    v_order_id,
    v_customer_id,
    v_subtotal_cents,
    p_delivery_fee_cents,
    v_subtotal_cents + p_delivery_fee_cents,
    p_checkout_cancel_token,
    v_checkout_expires_at;
end;
$$;

create or replace function public.attach_storefront_checkout_session(
  p_order_id uuid,
  p_session_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_existing_session_id text;
  v_status public.order_status;
begin
  if p_order_id is null
    or nullif(trim(coalesce(p_session_id, '')), '') is null
    or p_session_id !~ '^cs_[A-Za-z0-9_]+$'
    or char_length(p_session_id) > 255
  then
    raise exception 'Stripe Checkout attachment is invalid.';
  end if;

  select order_record.stripe_checkout_session_id, order_record.status
  into v_existing_session_id, v_status
  from public.orders order_record
  where order_record.id = p_order_id
    and order_record.source = 'storefront'
  for update;
  if not found then
    return false;
  end if;

  if v_existing_session_id is not null then
    if v_existing_session_id <> p_session_id then
      raise exception 'This order is already attached to a different Stripe Checkout Session.';
    end if;
    return true;
  end if;
  if v_status not in ('pending_payment', 'pending_approval_payment', 'canceled') then
    raise exception 'This order can no longer accept a Stripe Checkout Session.';
  end if;

  update public.orders order_record
  set stripe_checkout_session_id = p_session_id,
      updated_at = now()
  where order_record.id = p_order_id
    and order_record.stripe_checkout_session_id is null;
  return found;
end;
$$;

create or replace function public.cleanup_abandoned_storefront_checkouts()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_order record;
  v_canceled_order_id uuid;
  v_canceled_count integer := 0;
begin
  for v_order in
    select order_record.id
    from public.orders order_record
    where order_record.source = 'storefront'
      and order_record.status in ('pending_payment', 'pending_approval_payment')
      and order_record.stripe_checkout_session_id is null
      and order_record.created_at < now() - interval '26 hours'
    order by order_record.created_at
    limit 100
    for update skip locked
  loop
    v_canceled_order_id := public.cancel_storefront_checkout(
      p_order_id => v_order.id,
      p_actor_email => null,
      p_reason => 'No Stripe Checkout Session was attached within 26 hours.'
    );
    if v_canceled_order_id is not null then
      v_canceled_count := v_canceled_count + 1;
    end if;
  end loop;
  return v_canceled_count;
end;
$$;

revoke all on function public.create_storefront_checkout_order(
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  text,
  jsonb,
  numeric,
  text,
  jsonb,
  integer,
  text,
  boolean,
  text,
  jsonb,
  boolean
) from public, anon, authenticated;
revoke all on function public.attach_storefront_checkout_session(uuid, text)
  from public, anon, authenticated;
revoke all on function public.cleanup_abandoned_storefront_checkouts()
  from public, anon, authenticated;

grant execute on function public.create_storefront_checkout_order(
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  text,
  jsonb,
  numeric,
  text,
  jsonb,
  integer,
  text,
  boolean,
  text,
  jsonb,
  boolean
) to service_role;
grant execute on function public.attach_storefront_checkout_session(uuid, text)
  to service_role;
grant execute on function public.cleanup_abandoned_storefront_checkouts()
  to service_role;
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
create or replace function public.ensure_atomic_rolling_week(
  p_template_weekly_menu_id uuid,
  p_existing_weekly_menu_id uuid,
  p_name text,
  p_generation_key text,
  p_order_cutoff_at timestamptz,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_delivery_label text,
  p_delivery_starts_at timestamptz,
  p_delivery_ends_at timestamptz,
  p_delivery_capacity integer default 20
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_candidate_menu_id uuid;
  v_menu_id uuid;
  v_menu_auto_generated boolean;
  v_menu_published boolean;
  v_menu_generation_key text;
  v_menu_source_id uuid;
  v_template_item_count integer;
  v_delivery_window_id uuid;
  v_delivery_reserved integer := 0;
begin
  if p_template_weekly_menu_id is null then
    raise exception 'A rolling-week template is required.';
  end if;
  if char_length(trim(coalesce(p_name, ''))) not between 2 and 120 then
    raise exception 'Rolling-week name is invalid.';
  end if;
  if char_length(trim(coalesce(p_generation_key, ''))) not between 1 and 240 then
    raise exception 'Rolling-week generation key is invalid.';
  end if;
  if p_starts_at is null
    or p_ends_at is null
    or p_order_cutoff_at is null
    or p_starts_at >= p_ends_at
    or p_order_cutoff_at >= p_ends_at
  then
    raise exception 'Rolling-week dates are invalid.';
  end if;
  if char_length(trim(coalesce(p_delivery_label, ''))) not between 2 and 160 then
    raise exception 'Rolling-week delivery label is invalid.';
  end if;
  if p_delivery_starts_at is null
    or p_delivery_ends_at is null
    or p_delivery_starts_at >= p_delivery_ends_at
    or p_delivery_starts_at < p_starts_at
    or p_delivery_ends_at > p_ends_at
  then
    raise exception 'Rolling-week delivery dates are invalid.';
  end if;
  if p_delivery_capacity is null
    or p_delivery_capacity < 0
    or p_delivery_capacity > 1000
  then
    raise exception 'Rolling-week delivery capacity is invalid.';
  end if;

  -- Discover the existing row before locking, then acquire every menu lock in
  -- UUID order. This matches the other configuration commands and avoids a
  -- template/edit deadlock while still serializing generation from one source.
  if p_existing_weekly_menu_id is not null then
    select weekly_menu.id
    into v_candidate_menu_id
    from public.weekly_menus weekly_menu
    where weekly_menu.id = p_existing_weekly_menu_id;
  else
    select weekly_menu.id
    into v_candidate_menu_id
    from public.weekly_menus weekly_menu
    where weekly_menu.generation_key = trim(p_generation_key);
  end if;

  perform weekly_menu.id
  from public.weekly_menus weekly_menu
  where weekly_menu.id = p_template_weekly_menu_id
    or weekly_menu.id = v_candidate_menu_id
  order by weekly_menu.id
  for update;

  perform 1
  from public.weekly_menus weekly_menu
  where weekly_menu.id = p_template_weekly_menu_id;
  if not found then
    raise exception 'Rolling-week template could not be found.';
  end if;

  if p_existing_weekly_menu_id is not null then
    select
      weekly_menu.id,
      weekly_menu.auto_generated,
      weekly_menu.published,
      weekly_menu.generation_key,
      weekly_menu.source_weekly_menu_id
    into
      v_menu_id,
      v_menu_auto_generated,
      v_menu_published,
      v_menu_generation_key,
      v_menu_source_id
    from public.weekly_menus weekly_menu
    where weekly_menu.id = p_existing_weekly_menu_id
    for update;
    if not found then
      raise exception 'Existing rolling week could not be found.';
    end if;
  else
    select
      weekly_menu.id,
      weekly_menu.auto_generated,
      weekly_menu.published,
      weekly_menu.generation_key,
      weekly_menu.source_weekly_menu_id
    into
      v_menu_id,
      v_menu_auto_generated,
      v_menu_published,
      v_menu_generation_key,
      v_menu_source_id
    from public.weekly_menus weekly_menu
    where weekly_menu.generation_key = trim(p_generation_key)
    for update;
  end if;

  if v_menu_id is not null then
    if not v_menu_auto_generated then
      raise exception 'The rolling-week generation key belongs to a manual menu.';
    end if;
    if not v_menu_published then
      raise exception 'The existing rolling week is unpublished and will not be regenerated.';
    end if;
    if v_menu_generation_key is not null
      and v_menu_generation_key <> trim(p_generation_key)
    then
      raise exception 'The existing rolling week has a different generation key.';
    end if;
    if v_menu_source_id is not null
      and v_menu_source_id <> p_template_weekly_menu_id
    then
      raise exception 'The existing rolling week belongs to a different template.';
    end if;

    update public.weekly_menus
    set generation_key = coalesce(generation_key, trim(p_generation_key)),
        source_weekly_menu_id = coalesce(
          source_weekly_menu_id,
          p_template_weekly_menu_id
        )
    where id = v_menu_id;
  else
    insert into public.weekly_menus (
      name,
      order_cutoff_at,
      starts_at,
      ends_at,
      published,
      auto_generated,
      generation_key,
      source_weekly_menu_id
    )
    values (
      trim(p_name),
      p_order_cutoff_at,
      p_starts_at,
      p_ends_at,
      true,
      true,
      trim(p_generation_key),
      p_template_weekly_menu_id
    )
    on conflict (generation_key) do nothing
    returning id into v_menu_id;

    if v_menu_id is null then
      select
        weekly_menu.id,
        weekly_menu.auto_generated,
        weekly_menu.published,
        weekly_menu.source_weekly_menu_id
      into
        v_menu_id,
        v_menu_auto_generated,
        v_menu_published,
        v_menu_source_id
      from public.weekly_menus weekly_menu
      where weekly_menu.generation_key = trim(p_generation_key)
      for update;

      if v_menu_id is null
        or not v_menu_auto_generated
        or not v_menu_published
        or (
          v_menu_source_id is not null
          and v_menu_source_id <> p_template_weekly_menu_id
        )
      then
        raise exception 'Rolling week could not be created safely.';
      end if;
    end if;
  end if;

  select delivery_window.id, delivery_window.reserved
  into v_delivery_window_id, v_delivery_reserved
  from public.delivery_windows delivery_window
  where delivery_window.weekly_menu_id = v_menu_id
  for update;

  -- Preserve an already-booked delivery schedule. With no reservations, the
  -- generated week and its one delivery slot can be brought back into sync.
  if coalesce(v_delivery_reserved, 0) = 0 then
    update public.weekly_menus
    set order_cutoff_at = p_order_cutoff_at,
        starts_at = p_starts_at,
        ends_at = p_ends_at
    where id = v_menu_id;
  end if;

  select count(*)::integer
  into v_template_item_count
  from public.weekly_menu_items menu_item
  where menu_item.weekly_menu_id = p_template_weekly_menu_id;
  if v_template_item_count = 0 then
    raise exception 'Rolling-week template has no products.';
  end if;

  perform product.id
  from public.products product
  join public.weekly_menu_items template_item
    on template_item.product_id = product.id
  where template_item.weekly_menu_id = p_template_weekly_menu_id
  order by product.id
  for key share of product;

  -- ON CONFLICT preserves any later admin adjustment while filling every item
  -- that was absent from an incomplete generation attempt.
  insert into public.weekly_menu_items (
    weekly_menu_id,
    product_id,
    available_quantity,
    sold_quantity,
    featured,
    unavailable
  )
  select
    v_menu_id,
    template_item.product_id,
    template_item.available_quantity,
    0,
    template_item.featured,
    template_item.unavailable
  from public.weekly_menu_items template_item
  where template_item.weekly_menu_id = p_template_weekly_menu_id
  order by template_item.product_id
  on conflict (weekly_menu_id, product_id) do nothing;

  if v_delivery_window_id is null then
    insert into public.delivery_windows (
      weekly_menu_id,
      label,
      starts_at,
      ends_at,
      capacity,
      reserved
    )
    values (
      v_menu_id,
      trim(p_delivery_label),
      p_delivery_starts_at,
      p_delivery_ends_at,
      p_delivery_capacity,
      0
    );
  elsif v_delivery_reserved = 0 then
    update public.delivery_windows
    set label = trim(p_delivery_label),
        starts_at = p_delivery_starts_at,
        ends_at = p_delivery_ends_at
    where id = v_delivery_window_id;
  end if;

  return v_menu_id;
end;
$$;

revoke all on function public.ensure_atomic_rolling_week(
  uuid,
  uuid,
  text,
  text,
  timestamptz,
  timestamptz,
  timestamptz,
  text,
  timestamptz,
  timestamptz,
  integer
) from public, anon, authenticated;

grant execute on function public.ensure_atomic_rolling_week(
  uuid,
  uuid,
  text,
  text,
  timestamptz,
  timestamptz,
  timestamptz,
  text,
  timestamptz,
  timestamptz,
  integer
) to service_role;
create or replace function public.consume_bread_club_magic_link(
  p_token_hash text,
  p_session_hash text,
  p_session_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  link_row public.bread_club_magic_links%rowtype;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$'
    or p_session_hash !~ '^[0-9a-f]{64}$'
    or p_session_expires_at is null
    or p_session_expires_at <= now()
    or p_session_expires_at > now() + interval '60 days'
  then
    raise exception 'Bread Club magic-link exchange is invalid.';
  end if;

  select *
  into link_row
  from public.bread_club_magic_links
  where token_hash = p_token_hash
  for update;

  if link_row.id is null
    or link_row.used_at is not null
    or link_row.expires_at <= now()
  then
    return null;
  end if;

  update public.bread_club_magic_links
  set used_at = now()
  where id = link_row.id;

  insert into public.bread_club_sessions (
    membership_id,
    session_hash,
    expires_at
  )
  values (
    link_row.membership_id,
    p_session_hash,
    p_session_expires_at
  );

  return link_row.membership_id;
end;
$$;

revoke all on function public.consume_bread_club_magic_link(
  text,
  text,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.consume_bread_club_magic_link(
  text,
  text,
  timestamptz
) to service_role;
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

  return '20260808123000';
end;
$$;

revoke all on function public.operational_schema_healthcheck()
  from public, anon, authenticated;
grant execute on function public.operational_schema_healthcheck()
  to service_role;

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

-- Admin commands invoked from a selected delivery week must verify that scope
-- while the order row is locked. The existing commands remain available for
-- system maintenance paths that have no selected week.

create or replace function public.assert_admin_order_week_scope(
  p_order_id uuid,
  p_expected_weekly_menu_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_delivery_window_id uuid;
  v_weekly_menu_id uuid;
begin
  if p_order_id is null then
    raise exception 'Order ID is required.';
  end if;

  select order_record.delivery_window_id
  into v_delivery_window_id
  from public.orders order_record
  where order_record.id = p_order_id
  for update;

  if not found then
    raise exception 'Order could not be found.';
  end if;
  if p_expected_weekly_menu_id is null then
    return;
  end if;
  if v_delivery_window_id is null then
    raise exception 'Order is not assigned to a delivery week.';
  end if;

  select delivery_window.weekly_menu_id
  into v_weekly_menu_id
  from public.delivery_windows delivery_window
  where delivery_window.id = v_delivery_window_id;

  if v_weekly_menu_id is distinct from p_expected_weekly_menu_id then
    raise exception 'This order does not belong to the selected delivery week.';
  end if;
end;
$$;

create or replace function public.admin_transition_order_status_scoped(
  p_order_id uuid,
  p_expected_weekly_menu_id uuid default null,
  p_expected_status public.order_status default null,
  p_next_status public.order_status default null,
  p_actor_email text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.assert_admin_order_week_scope(
    p_order_id,
    p_expected_weekly_menu_id
  );
  return public.admin_transition_order_status(
    p_order_id,
    p_expected_status,
    p_next_status,
    p_actor_email
  );
end;
$$;

create or replace function public.admin_accept_approval_order_scoped(
  p_order_id uuid,
  p_expected_weekly_menu_id uuid default null,
  p_target_delivery_window_id uuid default null,
  p_actor_email text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.assert_admin_order_week_scope(
    p_order_id,
    p_expected_weekly_menu_id
  );
  return public.admin_accept_approval_order(
    p_order_id,
    p_target_delivery_window_id,
    p_actor_email
  );
end;
$$;

create or replace function public.admin_begin_approval_refund_scoped(
  p_order_id uuid,
  p_expected_weekly_menu_id uuid default null,
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
begin
  perform public.assert_admin_order_week_scope(
    p_order_id,
    p_expected_weekly_menu_id
  );
  return query
  select *
  from public.admin_begin_approval_refund(p_order_id, p_actor_email);
end;
$$;

create or replace function public.admin_record_approval_refund_scoped(
  p_order_id uuid,
  p_expected_weekly_menu_id uuid default null,
  p_refund_id text default null,
  p_refund_status text default null,
  p_actor_email text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.assert_admin_order_week_scope(
    p_order_id,
    p_expected_weekly_menu_id
  );
  return public.admin_record_approval_refund(
    p_order_id,
    p_refund_id,
    p_refund_status,
    p_actor_email
  );
end;
$$;

create or replace function public.admin_finalize_approval_refund_scoped(
  p_order_id uuid,
  p_expected_weekly_menu_id uuid default null,
  p_refund_id text default null,
  p_actor_email text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.assert_admin_order_week_scope(
    p_order_id,
    p_expected_weekly_menu_id
  );
  return public.admin_finalize_approval_refund(
    p_order_id,
    p_refund_id,
    p_actor_email
  );
end;
$$;

create or replace function public.admin_cancel_storefront_checkout_scoped(
  p_order_id uuid default null,
  p_expected_weekly_menu_id uuid default null,
  p_session_id text default null,
  p_cancel_token text default null,
  p_actor_email text default null,
  p_reason text default 'checkout_canceled'
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_order_id is null then
    raise exception 'Order ID is required for an admin cancellation.';
  end if;
  perform public.assert_admin_order_week_scope(
    p_order_id,
    p_expected_weekly_menu_id
  );
  return public.cancel_storefront_checkout(
    p_order_id,
    p_session_id,
    p_cancel_token,
    p_actor_email,
    p_reason
  );
end;
$$;

revoke all on function public.assert_admin_order_week_scope(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.admin_transition_order_status_scoped(uuid, uuid, public.order_status, public.order_status, text)
  from public, anon, authenticated;
revoke all on function public.admin_accept_approval_order_scoped(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.admin_begin_approval_refund_scoped(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.admin_record_approval_refund_scoped(uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.admin_finalize_approval_refund_scoped(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.admin_cancel_storefront_checkout_scoped(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.admin_transition_order_status_scoped(uuid, uuid, public.order_status, public.order_status, text)
  to service_role;
grant execute on function public.admin_accept_approval_order_scoped(uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.admin_begin_approval_refund_scoped(uuid, uuid, text)
  to service_role;
grant execute on function public.admin_record_approval_refund_scoped(uuid, uuid, text, text, text)
  to service_role;
grant execute on function public.admin_finalize_approval_refund_scoped(uuid, uuid, text, text)
  to service_role;
grant execute on function public.admin_cancel_storefront_checkout_scoped(uuid, uuid, text, text, text, text)
  to service_role;

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
    or to_regprocedure(
      'public.begin_bread_club_credit_refund_attempt(uuid)'
    ) is null
    or to_regprocedure(
      'public.record_bread_club_credit_refund(uuid,text,text,text,text)'
    ) is null
    or to_regprocedure(
      'public.begin_bread_club_cycle_refund_attempt(uuid)'
    ) is null
    or to_regprocedure(
      'public.record_bread_club_cycle_refund(uuid,text,text,text,text,text)'
    ) is null
    or to_regprocedure(
      'public.protect_bread_club_addon_during_refund()'
    ) is null
    or to_regprocedure(
      'public.begin_bread_club_plan_provider_change(uuid,uuid,jsonb)'
    ) is null
    or to_regprocedure(
      'public.begin_bread_club_address_provider_change(uuid,jsonb,text,jsonb,integer,text)'
    ) is null
    or to_regprocedure(
      'public.claim_bread_club_provider_sync(uuid,bigint)'
    ) is null
    or to_regprocedure(
      'public.finish_bread_club_provider_sync(uuid,bigint,uuid,text)'
    ) is null
    or to_regprocedure(
      'public.admin_transition_order_status_scoped(uuid,uuid,public.order_status,public.order_status,text)'
    ) is null
    or to_regprocedure(
      'public.admin_begin_approval_refund_scoped(uuid,uuid,text)'
    ) is null
    or to_regprocedure(
      'public.admin_cancel_storefront_checkout_scoped(uuid,uuid,text,text,text,text)'
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
        and column_record.table_name = 'bread_club_cycles'
        and column_record.column_name = 'refund_attempt_key'
    )
    or not exists (
      select 1
      from information_schema.columns column_record
      where column_record.table_schema = 'public'
        and column_record.table_name = 'bread_club_rollover_credits'
        and column_record.column_name = 'refund_attempt_key'
    )
    or not exists (
      select 1
      from information_schema.columns column_record
      where column_record.table_schema = 'public'
        and column_record.table_name = 'bread_club_memberships'
        and column_record.column_name = 'provider_sync_required'
    )
    or not exists (
      select 1
      from information_schema.columns column_record
      where column_record.table_schema = 'public'
        and column_record.table_name = 'bread_club_memberships'
        and column_record.column_name = 'provider_sync_claim_token'
    )
  then
    raise exception 'Required operational migrations are missing.';
  end if;

  return '20260808133000';
end;
$$;

revoke all on function public.operational_schema_healthcheck()
  from public, anon, authenticated;
grant execute on function public.operational_schema_healthcheck()
  to service_role;

-- Customer and admin mutations are handled by authenticated server routes and
-- tightly scoped service-role RPCs. RLS already denies direct writes, but
-- removing the underlying client grants provides a second independent fence.
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public
  from anon, authenticated;

revoke usage, select, update
  on all sequences in schema public
  from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger
  on tables
  from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke usage, select, update
  on sequences
  from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke execute
  on functions
  from public;

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
    or to_regprocedure(
      'public.begin_bread_club_credit_refund_attempt(uuid)'
    ) is null
    or to_regprocedure(
      'public.record_bread_club_credit_refund(uuid,text,text,text,text)'
    ) is null
    or to_regprocedure(
      'public.begin_bread_club_cycle_refund_attempt(uuid)'
    ) is null
    or to_regprocedure(
      'public.record_bread_club_cycle_refund(uuid,text,text,text,text,text)'
    ) is null
    or to_regprocedure(
      'public.protect_bread_club_addon_during_refund()'
    ) is null
    or to_regprocedure(
      'public.begin_bread_club_plan_provider_change(uuid,uuid,jsonb)'
    ) is null
    or to_regprocedure(
      'public.begin_bread_club_address_provider_change(uuid,jsonb,text,jsonb,integer,text)'
    ) is null
    or to_regprocedure(
      'public.claim_bread_club_provider_sync(uuid,bigint)'
    ) is null
    or to_regprocedure(
      'public.finish_bread_club_provider_sync(uuid,bigint,uuid,text)'
    ) is null
    or to_regprocedure(
      'public.admin_transition_order_status_scoped(uuid,uuid,public.order_status,public.order_status,text)'
    ) is null
    or to_regprocedure(
      'public.admin_begin_approval_refund_scoped(uuid,uuid,text)'
    ) is null
    or to_regprocedure(
      'public.admin_cancel_storefront_checkout_scoped(uuid,uuid,text,text,text,text)'
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
        and column_record.table_name = 'bread_club_cycles'
        and column_record.column_name = 'refund_attempt_key'
    )
    or not exists (
      select 1
      from information_schema.columns column_record
      where column_record.table_schema = 'public'
        and column_record.table_name = 'bread_club_rollover_credits'
        and column_record.column_name = 'refund_attempt_key'
    )
    or not exists (
      select 1
      from information_schema.columns column_record
      where column_record.table_schema = 'public'
        and column_record.table_name = 'bread_club_memberships'
        and column_record.column_name = 'provider_sync_required'
    )
    or not exists (
      select 1
      from information_schema.columns column_record
      where column_record.table_schema = 'public'
        and column_record.table_name = 'bread_club_memberships'
        and column_record.column_name = 'provider_sync_claim_token'
    )
    or exists (
      select 1
      from pg_catalog.pg_class table_record
      join pg_catalog.pg_namespace namespace
        on namespace.oid = table_record.relnamespace
      where namespace.nspname = 'public'
        and table_record.relkind = 'r'
        and (
          has_table_privilege(
            'anon',
            table_record.oid,
            'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
          )
          or has_table_privilege(
            'authenticated',
            table_record.oid,
            'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
          )
        )
    )
  then
    raise exception 'Required operational migrations are missing.';
  end if;

  return '20260808140000';
end;
$$;

revoke all on function public.operational_schema_healthcheck()
  from public, anon, authenticated;
grant execute on function public.operational_schema_healthcheck()
  to service_role;
