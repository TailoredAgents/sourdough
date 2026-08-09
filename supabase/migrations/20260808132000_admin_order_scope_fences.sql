-- Admin commands invoked from a selected delivery week must verify that scope
-- while the order row is locked. The existing commands remain available for
-- system maintenance paths that have no selected week.

create or replace function public.assert_admin_order_week_scope(
  p_order_id uuid,
  p_expected_weekly_menu_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_delivery_window_id uuid;
  v_weekly_menu_id uuid;
begin
  if p_order_id is null then
    raise exception 'Order ID is required.';
  end if;

  select order_record.delivery_window_id
  into v_delivery_window_id
  from public.orders order_record
  where order_record.id = p_order_id
  for update;

  if not found then
    raise exception 'Order could not be found.';
  end if;
  if p_expected_weekly_menu_id is null then
    return;
  end if;
  if v_delivery_window_id is null then
    raise exception 'Order is not assigned to a delivery week.';
  end if;

  select delivery_window.weekly_menu_id
  into v_weekly_menu_id
  from public.delivery_windows delivery_window
  where delivery_window.id = v_delivery_window_id;

  if v_weekly_menu_id is distinct from p_expected_weekly_menu_id then
    raise exception 'This order does not belong to the selected delivery week.';
  end if;
end;
$$;

create or replace function public.admin_transition_order_status_scoped(
  p_order_id uuid,
  p_expected_weekly_menu_id uuid default null,
  p_expected_status public.order_status default null,
  p_next_status public.order_status default null,
  p_actor_email text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.assert_admin_order_week_scope(
    p_order_id,
    p_expected_weekly_menu_id
  );
  return public.admin_transition_order_status(
    p_order_id,
    p_expected_status,
    p_next_status,
    p_actor_email
  );
end;
$$;

create or replace function public.admin_accept_approval_order_scoped(
  p_order_id uuid,
  p_expected_weekly_menu_id uuid default null,
  p_target_delivery_window_id uuid default null,
  p_actor_email text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.assert_admin_order_week_scope(
    p_order_id,
    p_expected_weekly_menu_id
  );
  return public.admin_accept_approval_order(
    p_order_id,
    p_target_delivery_window_id,
    p_actor_email
  );
end;
$$;

create or replace function public.admin_begin_approval_refund_scoped(
  p_order_id uuid,
  p_expected_weekly_menu_id uuid default null,
  p_actor_email text default null
)
returns table (
  checkout_session_id text,
  refund_id text
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.assert_admin_order_week_scope(
    p_order_id,
    p_expected_weekly_menu_id
  );
  return query
  select *
  from public.admin_begin_approval_refund(p_order_id, p_actor_email);
end;
$$;

create or replace function public.admin_record_approval_refund_scoped(
  p_order_id uuid,
  p_expected_weekly_menu_id uuid default null,
  p_refund_id text default null,
  p_refund_status text default null,
  p_actor_email text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.assert_admin_order_week_scope(
    p_order_id,
    p_expected_weekly_menu_id
  );
  return public.admin_record_approval_refund(
    p_order_id,
    p_refund_id,
    p_refund_status,
    p_actor_email
  );
end;
$$;

create or replace function public.admin_finalize_approval_refund_scoped(
  p_order_id uuid,
  p_expected_weekly_menu_id uuid default null,
  p_refund_id text default null,
  p_actor_email text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.assert_admin_order_week_scope(
    p_order_id,
    p_expected_weekly_menu_id
  );
  return public.admin_finalize_approval_refund(
    p_order_id,
    p_refund_id,
    p_actor_email
  );
end;
$$;

create or replace function public.admin_cancel_storefront_checkout_scoped(
  p_order_id uuid default null,
  p_expected_weekly_menu_id uuid default null,
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
begin
  if p_order_id is null then
    raise exception 'Order ID is required for an admin cancellation.';
  end if;
  perform public.assert_admin_order_week_scope(
    p_order_id,
    p_expected_weekly_menu_id
  );
  return public.cancel_storefront_checkout(
    p_order_id,
    p_session_id,
    p_cancel_token,
    p_actor_email,
    p_reason
  );
end;
$$;

revoke all on function public.assert_admin_order_week_scope(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.admin_transition_order_status_scoped(uuid, uuid, public.order_status, public.order_status, text)
  from public, anon, authenticated;
revoke all on function public.admin_accept_approval_order_scoped(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.admin_begin_approval_refund_scoped(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.admin_record_approval_refund_scoped(uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.admin_finalize_approval_refund_scoped(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.admin_cancel_storefront_checkout_scoped(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.admin_transition_order_status_scoped(uuid, uuid, public.order_status, public.order_status, text)
  to service_role;
grant execute on function public.admin_accept_approval_order_scoped(uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.admin_begin_approval_refund_scoped(uuid, uuid, text)
  to service_role;
grant execute on function public.admin_record_approval_refund_scoped(uuid, uuid, text, text, text)
  to service_role;
grant execute on function public.admin_finalize_approval_refund_scoped(uuid, uuid, text, text)
  to service_role;
grant execute on function public.admin_cancel_storefront_checkout_scoped(uuid, uuid, text, text, text, text)
  to service_role;
