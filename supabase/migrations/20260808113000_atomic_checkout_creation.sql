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
