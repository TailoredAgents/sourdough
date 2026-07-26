alter table public.orders
  add column if not exists tax_cents integer not null default 0
  check (tax_cents >= 0);

alter table public.bread_club_addon_checkouts
  add column if not exists tax_cents integer not null default 0
  check (tax_cents >= 0),
  add column if not exists total_cents integer not null default 0
  check (total_cents >= 0);

update public.bread_club_addon_checkouts
set total_cents = subtotal_cents + tax_cents
where total_cents = 0;

drop function if exists public.complete_bread_club_addon_checkout(uuid, text);

create or replace function public.complete_bread_club_addon_checkout(
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

revoke all on function public.complete_bread_club_addon_checkout(
  uuid,
  text,
  integer,
  integer
) from public, anon, authenticated;

grant execute on function public.complete_bread_club_addon_checkout(
  uuid,
  text,
  integer,
  integer
) to service_role;
