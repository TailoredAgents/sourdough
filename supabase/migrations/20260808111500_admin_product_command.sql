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
