create table if not exists public.admin_order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  actor_email text,
  action text not null,
  previous_status order_status,
  next_status order_status,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_order_events_order_created_idx
  on public.admin_order_events(order_id, created_at desc);

alter table public.admin_order_events enable row level security;

create or replace function public.reserve_order_inventory(
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

create or replace function public.release_order_inventory(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  order_row public.orders%rowtype;
  item_row record;
  window_weekly_menu_id uuid;
begin
  select *
  into order_row
  from public.orders
  where id = p_order_id;

  if order_row.id is null or order_row.delivery_window_id is null then
    return;
  end if;

  select weekly_menu_id
  into window_weekly_menu_id
  from public.delivery_windows
  where id = order_row.delivery_window_id;

  if window_weekly_menu_id is null then
    return;
  end if;

  update public.delivery_windows
  set reserved = greatest(reserved - 1, 0)
  where id = order_row.delivery_window_id;

  for item_row in
    select product_id, quantity
    from public.order_items
    where order_id = p_order_id
    order by product_id
  loop
    update public.weekly_menu_items
    set sold_quantity = greatest(sold_quantity - item_row.quantity, 0)
    where weekly_menu_id = window_weekly_menu_id
      and product_id = item_row.product_id;
  end loop;
end;
$$;

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
