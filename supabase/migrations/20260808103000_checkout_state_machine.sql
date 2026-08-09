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
      order_id,
      action,
      previous_status,
      next_status,
      details
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
