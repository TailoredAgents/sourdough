insert into delivery_settings (
  id,
  center_lat,
  center_lng,
  radius_miles,
  delivery_fee_cents,
  allowed_postal_codes,
  service_area_copy
) values (
  true,
  34.236800,
  -84.490800,
  12,
  600,
  array['30114', '30115', '30107', '30183', '30188', '30189'],
  'Delivery is available in selected ZIP codes around Canton and Woodstock: 30114, 30115, 30107, 30183, 30188, and 30189.'
) on conflict (id) do update set
  center_lat = excluded.center_lat,
  center_lng = excluded.center_lng,
  radius_miles = excluded.radius_miles,
  delivery_fee_cents = excluded.delivery_fee_cents,
  allowed_postal_codes = excluded.allowed_postal_codes,
  service_area_copy = excluded.service_area_copy;

insert into products (
  id,
  slug,
  name,
  category,
  description,
  ingredients,
  allergens,
  price_cents,
  image_style,
  active
) values
  (
    '00000000-0000-4000-8000-000000000001',
    'classic-country',
    'Classic Country Loaf',
    'bread',
    'A naturally leavened sourdough loaf with a crisp crust, tender open crumb, and mild tang.',
    array['Organic bread flour', 'filtered water', 'sea salt', 'starter'],
    array['Wheat'],
    1200,
    'from-stone-100 via-amber-100 to-orange-200',
    true
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    'rosemary-garlic',
    'Rosemary Garlic Loaf',
    'bread',
    'Savory sourdough folded with rosemary and roasted garlic for soups, boards, and sandwiches.',
    array['Organic bread flour', 'filtered water', 'sea salt', 'starter', 'rosemary', 'garlic'],
    array['Wheat'],
    1400,
    'from-emerald-100 via-stone-100 to-amber-200',
    true
  ),
  (
    '00000000-0000-4000-8000-000000000003',
    'cinnamon-swirl',
    'Cinnamon Swirl Sourdough',
    'bread',
    'A softer loaf with cinnamon sugar swirls, made for breakfast slices and weekend French toast.',
    array['Organic bread flour', 'filtered water', 'sea salt', 'starter', 'cinnamon', 'brown sugar'],
    array['Wheat'],
    1500,
    'from-rose-100 via-amber-100 to-stone-100',
    true
  ),
  (
    '00000000-0000-4000-8000-000000000004',
    'starter-crackers',
    'Sourdough Starter Crackers',
    'add-on',
    'Crisp snack crackers made from sourdough starter discard with herbs and flaky salt.',
    array['Starter', 'flour', 'olive oil', 'herbs', 'sea salt'],
    array['Wheat'],
    700,
    'from-yellow-100 via-stone-100 to-lime-100',
    true
  ),
  (
    '00000000-0000-4000-8000-000000000005',
    'honey-butter',
    'Whipped Honey Butter',
    'add-on',
    'A small-batch sweet spread for warm slices, delivered chilled with each order.',
    array['Butter', 'local honey', 'sea salt'],
    array['Milk'],
    600,
    'from-yellow-50 via-amber-100 to-orange-100',
    true
  )
on conflict (slug) do update set
  name = excluded.name,
  category = excluded.category,
  description = excluded.description,
  ingredients = excluded.ingredients,
  allergens = excluded.allergens,
  price_cents = excluded.price_cents,
  image_style = excluded.image_style,
  active = excluded.active,
  updated_at = now();

with launch_schedule as (
  select
    ((date_trunc('day', now() at time zone 'America/New_York') + interval '1 day 20 hours') at time zone 'America/New_York') as order_cutoff_at,
    ((date_trunc('day', now() at time zone 'America/New_York') + interval '2 days') at time zone 'America/New_York') as starts_at,
    ((date_trunc('day', now() at time zone 'America/New_York') + interval '5 days 23 hours 59 minutes') at time zone 'America/New_York') as ends_at
)
insert into weekly_menus (
  id,
  name,
  order_cutoff_at,
  starts_at,
  ends_at,
  published
)
select
  '00000000-0000-4000-8000-000000000100',
  'Starter Bake Drop',
  order_cutoff_at,
  starts_at,
  ends_at,
  true
from launch_schedule
on conflict (id) do update set
  name = excluded.name,
  order_cutoff_at = excluded.order_cutoff_at,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  published = excluded.published;

insert into weekly_menu_items (
  weekly_menu_id,
  product_id,
  available_quantity,
  sold_quantity,
  featured
) values
  ('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000001', 18, 5, true),
  ('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000002', 12, 3, true),
  ('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000003', 10, 8, false),
  ('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000004', 20, 4, false),
  ('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000005', 20, 7, false)
on conflict (weekly_menu_id, product_id) do update set
  available_quantity = excluded.available_quantity,
  sold_quantity = excluded.sold_quantity,
  featured = excluded.featured;

with launch_windows as (
  select
    ((date_trunc('day', now() at time zone 'America/New_York') + interval '2 days 15 hours') at time zone 'America/New_York') as first_starts_at,
    ((date_trunc('day', now() at time zone 'America/New_York') + interval '2 days 18 hours') at time zone 'America/New_York') as first_ends_at,
    ((date_trunc('day', now() at time zone 'America/New_York') + interval '3 days 9 hours') at time zone 'America/New_York') as second_starts_at,
    ((date_trunc('day', now() at time zone 'America/New_York') + interval '3 days 12 hours') at time zone 'America/New_York') as second_ends_at,
    ((date_trunc('day', now() at time zone 'America/New_York') + interval '4 days 14 hours') at time zone 'America/New_York') as third_starts_at,
    ((date_trunc('day', now() at time zone 'America/New_York') + interval '4 days 17 hours') at time zone 'America/New_York') as third_ends_at
),
windows as (
  select
    '00000000-0000-4000-8000-000000000201' as id,
    '00000000-0000-4000-8000-000000000100' as weekly_menu_id,
    to_char(first_starts_at at time zone 'America/New_York', 'FMDay, Mon FMDD, FMHH12:MI AM') || '-' ||
      to_char(first_ends_at at time zone 'America/New_York', 'FMHH12:MI AM') as label,
    first_starts_at as starts_at,
    first_ends_at as ends_at,
    16 as capacity,
    5 as reserved
  from launch_windows
  union all
  select
    '00000000-0000-4000-8000-000000000202',
    '00000000-0000-4000-8000-000000000100',
    to_char(second_starts_at at time zone 'America/New_York', 'FMDay, Mon FMDD, FMHH12:MI AM') || '-' ||
      to_char(second_ends_at at time zone 'America/New_York', 'FMHH12:MI AM'),
    second_starts_at,
    second_ends_at,
    12,
    4
  from launch_windows
  union all
  select
    '00000000-0000-4000-8000-000000000203',
    '00000000-0000-4000-8000-000000000100',
    to_char(third_starts_at at time zone 'America/New_York', 'FMDay, Mon FMDD, FMHH12:MI AM') || '-' ||
      to_char(third_ends_at at time zone 'America/New_York', 'FMHH12:MI AM'),
    third_starts_at,
    third_ends_at,
    12,
    3
  from launch_windows
)
insert into delivery_windows (
  id,
  weekly_menu_id,
  label,
  starts_at,
  ends_at,
  capacity,
  reserved
)
select id, weekly_menu_id, label, starts_at, ends_at, capacity, reserved
from windows
on conflict (id) do update set
  weekly_menu_id = excluded.weekly_menu_id,
  label = excluded.label,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  capacity = excluded.capacity,
  reserved = excluded.reserved;

insert into ai_knowledge_entries (
  id,
  title,
  body,
  approved
) values
  (
    '00000000-0000-4000-8000-000000000301',
    'Bakery location',
    'Luna & Lorelai''s Sourdough is a local cottage bakery in Canton, GA.',
    true
  ),
  (
    '00000000-0000-4000-8000-000000000302',
    'Delivery scope',
    'Orders are intended for local Georgia delivery only. The v1 site does not ship bread.',
    true
  ),
  (
    '00000000-0000-4000-8000-000000000303',
    'Weekly cutoff',
    'The current order cutoff is set on the active weekly menu and shown before checkout.',
    true
  ),
  (
    '00000000-0000-4000-8000-000000000304',
    'Last-minute requests',
    'After the posted cutoff, customers can send a last-minute request, but the bakery must confirm availability.',
    true
  ),
  (
    '00000000-0000-4000-8000-000000000305',
    'Allergen guardrail',
    'All product allergen details must come from the product cards. Do not claim allergen-free preparation.',
    true
  ),
  (
    '00000000-0000-4000-8000-000000000306',
    'Delivery settings',
    'Allowed delivery ZIP codes and delivery fee are configured by the bakery owner in admin.',
    true
  )
on conflict (id) do update set
  title = excluded.title,
  body = excluded.body,
  approved = excluded.approved,
  updated_at = now();
