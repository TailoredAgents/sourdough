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
    'paid',
    'baking',
    'out_for_delivery',
    'delivered',
    'canceled'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  category product_category not null,
  description text not null,
  ingredients text[] not null default '{}',
  allergens text[] not null default '{}',
  price_cents integer not null check (price_cents >= 0),
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists weekly_menus (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  order_cutoff_at timestamptz not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  published boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists weekly_menu_items (
  id uuid primary key default gen_random_uuid(),
  weekly_menu_id uuid not null references weekly_menus(id) on delete cascade,
  product_id uuid not null references products(id),
  available_quantity integer not null check (available_quantity >= 0),
  sold_quantity integer not null default 0 check (sold_quantity >= 0),
  featured boolean not null default false,
  unique (weekly_menu_id, product_id)
);

create table if not exists delivery_settings (
  id boolean primary key default true,
  center_lat numeric(9,6) not null default 34.236800,
  center_lng numeric(9,6) not null default -84.490800,
  radius_miles numeric(5,2) not null default 12,
  delivery_fee_cents integer not null default 600,
  check (id)
);

create table if not exists delivery_windows (
  id uuid primary key default gen_random_uuid(),
  weekly_menu_id uuid not null references weekly_menus(id) on delete cascade,
  label text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer not null check (capacity >= 0),
  reserved integer not null default 0 check (reserved >= 0)
);

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
  total_cents integer not null default 0,
  delivery_address jsonb not null,
  delivery_miles numeric(5,2),
  notes text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists ai_knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table products enable row level security;
alter table weekly_menus enable row level security;
alter table weekly_menu_items enable row level security;
alter table delivery_settings enable row level security;
alter table delivery_windows enable row level security;
alter table customers enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table customer_messages enable row level security;
alter table ai_knowledge_entries enable row level security;

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
