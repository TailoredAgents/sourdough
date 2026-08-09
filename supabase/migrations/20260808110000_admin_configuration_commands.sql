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
