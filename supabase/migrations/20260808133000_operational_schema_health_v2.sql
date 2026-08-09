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
    or to_regprocedure(
      'public.ensure_atomic_bread_club_renewal_cycle(uuid,integer,timestamptz,timestamptz,integer,integer,integer,jsonb)'
    ) is null
    or to_regprocedure(
      'public.begin_bread_club_credit_refund_attempt(uuid)'
    ) is null
    or to_regprocedure(
      'public.record_bread_club_credit_refund(uuid,text,text,text,text)'
    ) is null
    or to_regprocedure(
      'public.begin_bread_club_cycle_refund_attempt(uuid)'
    ) is null
    or to_regprocedure(
      'public.record_bread_club_cycle_refund(uuid,text,text,text,text,text)'
    ) is null
    or to_regprocedure(
      'public.protect_bread_club_addon_during_refund()'
    ) is null
    or to_regprocedure(
      'public.begin_bread_club_plan_provider_change(uuid,uuid,jsonb)'
    ) is null
    or to_regprocedure(
      'public.begin_bread_club_address_provider_change(uuid,jsonb,text,jsonb,integer,text)'
    ) is null
    or to_regprocedure(
      'public.claim_bread_club_provider_sync(uuid,bigint)'
    ) is null
    or to_regprocedure(
      'public.finish_bread_club_provider_sync(uuid,bigint,uuid,text)'
    ) is null
    or to_regprocedure(
      'public.admin_transition_order_status_scoped(uuid,uuid,public.order_status,public.order_status,text)'
    ) is null
    or to_regprocedure(
      'public.admin_begin_approval_refund_scoped(uuid,uuid,text)'
    ) is null
    or to_regprocedure(
      'public.admin_cancel_storefront_checkout_scoped(uuid,uuid,text,text,text,text)'
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
        and column_record.table_name = 'bread_club_cycles'
        and column_record.column_name = 'refund_attempt_key'
    )
    or not exists (
      select 1
      from information_schema.columns column_record
      where column_record.table_schema = 'public'
        and column_record.table_name = 'bread_club_rollover_credits'
        and column_record.column_name = 'refund_attempt_key'
    )
    or not exists (
      select 1
      from information_schema.columns column_record
      where column_record.table_schema = 'public'
        and column_record.table_name = 'bread_club_memberships'
        and column_record.column_name = 'provider_sync_required'
    )
    or not exists (
      select 1
      from information_schema.columns column_record
      where column_record.table_schema = 'public'
        and column_record.table_name = 'bread_club_memberships'
        and column_record.column_name = 'provider_sync_claim_token'
    )
  then
    raise exception 'Required operational migrations are missing.';
  end if;

  return '20260808133000';
end;
$$;

revoke all on function public.operational_schema_healthcheck()
  from public, anon, authenticated;
grant execute on function public.operational_schema_healthcheck()
  to service_role;
