insert into delivery_settings (
  id,
  center_lat,
  center_lng,
  radius_miles,
  delivery_fee_cents
) values (
  true,
  34.236800,
  -84.490800,
  12,
  600
) on conflict (id) do update set
  center_lat = excluded.center_lat,
  center_lng = excluded.center_lng,
  radius_miles = excluded.radius_miles,
  delivery_fee_cents = excluded.delivery_fee_cents;

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

insert into weekly_menus (
  id,
  name,
  order_cutoff_at,
  starts_at,
  ends_at,
  published
) values (
  '00000000-0000-4000-8000-000000000100',
  'Launch Week Bake Drop',
  '2026-07-09T20:00:00-04:00',
  '2026-07-15T00:00:00-04:00',
  '2026-07-17T23:59:59-04:00',
  true
) on conflict (id) do update set
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

insert into delivery_windows (
  id,
  weekly_menu_id,
  label,
  starts_at,
  ends_at,
  capacity,
  reserved
) values
  (
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000100',
    'Wednesday, 3:00-6:00 PM',
    '2026-07-15T15:00:00-04:00',
    '2026-07-15T18:00:00-04:00',
    16,
    5
  ),
  (
    '00000000-0000-4000-8000-000000000202',
    '00000000-0000-4000-8000-000000000100',
    'Thursday, 9:00 AM-12:00 PM',
    '2026-07-16T09:00:00-04:00',
    '2026-07-16T12:00:00-04:00',
    12,
    4
  ),
  (
    '00000000-0000-4000-8000-000000000203',
    '00000000-0000-4000-8000-000000000100',
    'Friday, 2:00-5:00 PM',
    '2026-07-17T14:00:00-04:00',
    '2026-07-17T17:00:00-04:00',
    12,
    3
  )
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
    'L&L Sourdough is a local cottage bakery in Canton, GA.',
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
    'Weekly orders close every Thursday at 8:00 PM for the next week''s bake and delivery schedule.',
    true
  ),
  (
    '00000000-0000-4000-8000-000000000304',
    'Last-minute requests',
    'After the cutoff, customers can send a last-minute request, but it is not guaranteed.',
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
    'Delivery radius and delivery fee are configured by the bakery owner before launch.',
    true
  )
on conflict (id) do update set
  title = excluded.title,
  body = excluded.body,
  approved = excluded.approved,
  updated_at = now();
