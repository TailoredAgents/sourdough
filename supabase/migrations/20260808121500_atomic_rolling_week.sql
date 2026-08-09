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
