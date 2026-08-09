create or replace function public.operational_schema_healthcheck()
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if to_regprocedure(
    'public.admin_begin_approval_refund(uuid,text)'
  ) is null
    or to_regprocedure(
      'public.attach_storefront_checkout_session(uuid,text)'
    ) is null
    or to_regprocedure(
      'public.claim_order_notification_job(text)'
    ) is null
    or to_regprocedure(
      'public.consume_bread_club_magic_link(text,text,timestamptz)'
    ) is null
    or to_regprocedure(
      'public.ensure_atomic_rolling_week(uuid,uuid,text,text,timestamptz,timestamptz,timestamptz,text,timestamptz,timestamptz,integer)'
    ) is null
    or not exists (
      select 1
      from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace
        on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = 'create_bread_club_subscription_checkout'
    )
    or not exists (
      select 1
      from information_schema.columns column_record
      where column_record.table_schema = 'public'
        and column_record.table_name = 'orders'
        and column_record.column_name = 'approval_refund_started_at'
    )
    or not exists (
      select 1
      from information_schema.columns column_record
      where column_record.table_schema = 'public'
        and column_record.table_name = 'orders'
        and column_record.column_name = 'checkout_attempt_id'
    )
    or not exists (
      select 1
      from information_schema.columns column_record
      where column_record.table_schema = 'public'
        and column_record.table_name = 'bread_club_memberships'
        and column_record.column_name = 'checkout_attempt_id'
    )
  then
    raise exception 'Required operational migrations are missing.';
  end if;

  return '20260808123000';
end;
$$;

revoke all on function public.operational_schema_healthcheck()
  from public, anon, authenticated;
grant execute on function public.operational_schema_healthcheck()
  to service_role;
