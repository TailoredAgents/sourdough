# Admin Operations and Hardening Runbook

Updated August 8, 2026. This is the operating guide and rollout gate for the
admin and reliability hardening pass.

## The Owner Workflow: 1-2-3

The admin is organized around one selected Sunday bake week. Confirm the week
shown at the top before making changes.

1. **Review:** Open Today’s 1-2-3, handle new customer messages, then accept,
   move, or refund any approval requests. Payment and inventory counters are
   automatic and cannot be typed over.
2. **Bake and deliver:** In Orders, advance only the guided action shown for
   each order: Paid → Baking → Out for delivery → Delivered. Open the Sunday
   route for the same selected week; orders at one physical address are grouped
   into one stop.
3. **Close the loop:** Confirm every stop is delivered and the inbox is clear.
   Marking an order Delivered queues the branded thank-you/review email inside
   the same database transaction. The admin reports either “sent” or “queued
   for automatic retry”; a temporary email outage does not lose the message.

## Weekly Setup: 1-2-3

1. **Menu:** Select or create the bake week, choose products, set total
   inventory, mark sold-out products unavailable, then save. Sold/reserved
   quantity is read-only. A product already committed to an order cannot be
   removed or reduced below its committed quantity.
2. **Delivery:** With the same week selected, confirm ZIP codes, delivery fee,
   and one Sunday 3:00–6:00 PM Eastern slot. Once the slot has reservations,
   its label and time are locked; capacity may only stay at or above reserved
   orders.
3. **Publish and prove:** Publish the menu, refresh the storefront, run one ZIP
   check, confirm the authenticated `/api/health?deep=1` database probe, and
   verify the Sunday route shows only that week.

Menu, inventory, delivery settings, and slot changes are committed by atomic
database commands. If any validation or write fails, none of that save is
retained. Every successful configuration command records the acting admin.
Switching weeks with unsaved menu or delivery edits produces one combined
warning so both editors move together instead of silently showing different
weeks.

## What This Hardening Pass Protects

- Storefront fulfillment requires Stripe `paid` or `no_payment_required`; the
  signed currency, subtotal, tax, and total must match the database order.
- Storefront order creation, price validation, inventory reservation, and
  retry deduplication are one database command. Each browser attempt has a
  request fingerprint and a fenced Stripe-session attachment; an identical
  retry resumes the same order instead of reserving inventory twice.
- Immediate and delayed Stripe success/failure events are supported. Event and
  scheduled-job claims use expiring, fenced lease tokens so an old worker
  cannot overwrite a newer retry.
- Checkout cancellation and inventory release are one transaction. If payment
  lands after a local cancellation, inventory is recovered atomically when
  possible; otherwise the paid order becomes a visible approval exception.
- An admin cannot cancel an attached storefront checkout until Stripe confirms
  that its session is expired. Approval refunds acquire a database claim before
  calling Stripe, which blocks a simultaneous accept or move until the refund
  is recorded and finalized.
- Admin status changes, approval acceptance/moves, cancellation, and refund
  finalization use locked, expected-state database commands with immutable
  order audit events.
- Delivered-order thank-you emails use a transactional outbox with leases,
  backoff, deduplication, and cron recovery.
- Weekly menu and delivery configuration saves are atomic and audited. The
  database enforces one standard Sunday slot per menu and prevents rescheduling
  customers who already have reservations.
- Rolling-week generation creates or repairs the menu, copied products, and
  delivery slot in one transaction. A partial week is never published if a
  required product or slot write fails.
- Bread Club subscription and add-on checkout creation, frozen price snapshots,
  Stripe-session attachment, completion, expiry/cancellation, and retries use
  attempt IDs and database state fences. Replayed requests cannot create a
  second active checkout for the same attempt.
- Bread Club renewal cycles, all four fulfillment orders, inventory
  reservations, and cycle activation are transactional. A renewal cannot bill
  from a partial cycle, activate canceled reservations, or proceed while a
  saved Stripe plan/delivery change is still unconfirmed.
- Bread Club plan and address changes first save an immutable desired-state
  snapshot. A leased, idempotent reconciliation worker applies that exact
  revision to Stripe; stale workers cannot overwrite a newer change, and the
  admin visibly reports memberships still awaiting Stripe confirmation.
- Bread Club full-cycle and rollover-credit refunds retain one durable Stripe
  attempt until its result is known and only release inventory after Stripe
  reports success. Production work, redeemed credits, paid/open add-ons, and
  late payment events are fenced from racing a refund. Credit refund
  eligibility is based on what remained unused when cancellation occurred,
  even if provider reconciliation arrives after the nominal expiry time.
- Bread Club sign-in links open a confirmation screen instead of being consumed
  by an email scanner's GET request. Confirmation is a same-origin POST, and
  consuming the one-time link plus creating its session is one transaction.
  Member and portal mutations are also rate limited.
- Customer-facing rate limits use an atomic database counter. On Render, the
  app rejects spoofable left-most forwarding values, trusts Cloudflare's
  visitor header only with an origin-verification secret, adds IP-only abuse
  ceilings, expires old limiter rows, and fails closed in production if shared
  rate-limit storage is unavailable.
- Admin redirects reject off-site destinations, and every authenticated admin
  mutation rejects a foreign or missing production `Origin`. Checkout
  cancellation bearer tokens stay server-only. Security headers, a production
  HSTS policy, three distinct 32+ character operational secrets, and
  shallow/deep health checks are enabled. The authenticated deep check rejects
  an incomplete schema and reports version `20260808140000`.
- Admin counts, route planning, and order actions are scoped to the selected
  bake week in both the UI and locked database command. Route stops retain every
  customer contact at a shared address. The inbox exposes additional pages
  instead of silently dropping older messages. Mobile order selection moves
  focus to the detail panel, and the next active order is selected after
  completion.

Stripe recommends webhook-driven fulfillment because customers may never reach
the success page, and delayed payment methods complete later:
<https://docs.stripe.com/checkout/fulfillment>. Render documents the forwarded
client-address behavior used by the rate limiter:
<https://render.com/articles/how-render-handles-ddos-attacks>.

## Production Rollout Gate

1. Take a Supabase database backup or point-in-time snapshot and a separate
   export of the `product-images` Storage bucket. Supabase database backups
   preserve Storage metadata, not the image objects themselves. Record row
   counts for orders, order items, weekly menus/items, delivery windows, Stripe
   events, Bread Club jobs, and email events. Do not call the backup proven
   until a database-plus-images restore has succeeded in a separate project.
2. Before starting the sequence—and specifically before
   `20260808110000_admin_configuration_commands.sql`—check that each menu has
   at most one delivery slot:

   ```sql
   select weekly_menu_id, count(*)
   from public.delivery_windows
   group by weekly_menu_id
   having count(*) > 1;
   ```

   The result must be empty. If it is not, retain the slot referenced by real
   orders and reconcile the others manually; never delete a reserved slot just
   to make the migration pass.
3. Apply these migrations in order:

   ```text
   20260808090000_webhook_inventory_hardening.sql
   20260808093000_admin_order_commands.sql
   20260808094500_atomic_rate_limits.sql
   20260808100000_webhook_claim_leases.sql
   20260808101500_admin_refund_finalize.sql
   20260808103000_checkout_state_machine.sql
   20260808104500_order_notification_outbox.sql
   20260808110000_admin_configuration_commands.sql
   20260808111500_admin_product_command.sql
   20260808113000_atomic_checkout_creation.sql
   20260808114500_bread_club_checkout_boundaries.sql
   20260808120000_admin_payment_fences.sql
   20260808121500_atomic_rolling_week.sql
   20260808122000_atomic_magic_link_exchange.sql
   20260808123000_operational_schema_health.sql
   20260808124500_atomic_bread_club_renewal_cycle.sql
   20260808130000_bread_club_refund_fences.sql
   20260808131500_bread_club_provider_sync.sql
   20260808132000_admin_order_scope_fences.sql
   20260808133000_operational_schema_health_v2.sql
   20260808134500_public_table_write_grants.sql
   20260808140000_operational_schema_health_v3.sql
   ```

4. Set three unique random values of at least 32 characters for `CRON_SECRET`,
   `BREAD_CLUB_SETUP_SECRET`, and `CLOUDFLARE_ORIGIN_SECRET`; never reuse one as
   another. Put the cron value on both Render services. In Cloudflare, create a
   Request Header Transform Rule for the production hostname that overwrites
   `x-landl-origin-verify` with the origin secret, and keep the production DNS
   record proxied. Direct Render traffic does not receive trusted
   `CF-Connecting-IP` treatment.
5. Deploy the application. Rerun the protected Bread Club setup/sync operation
   with `BREAD_CLUB_SETUP_SECRET` so the production Stripe endpoint subscribes
   to the updated event list. Application code cannot change an already-created
   Stripe endpoint by itself.
6. Run `npm run validate`, `npm audit --omit=dev`, and `/api/health`. Run the
   authenticated deep probe and require `ok: true`, `database: "reachable"`,
   and `schemaVersion: "20260808140000"`:

   ```sh
   curl -fsS \
     -H "Authorization: Bearer $CRON_SECRET" \
     "https://www.landlsourdough.com/api/health?deep=1"
   ```

7. In Stripe test mode, exercise ordinary and delayed-payment success/failure,
   abandoned/expired cancellation, sold-out contention, an approval refund,
   a Bread Club subscription, an add-on, and a portal session. Confirm Stripe's
   Dashboard shows successful signed webhook deliveries and no duplicated
   Checkout Sessions or refunds.
8. Send real provider-backed test messages through Resend for confirmation,
   status, approval, reply, magic-link, and Delivered thank-you/review emails.
   Confirm delivery events, branding, links, and monitored reply addresses; a
   mocked or previewed email is not a production delivery test.
9. Keep public enrollment or paid ordering disabled if a migration, deep health
   check, webhook delivery, cron run, Stripe test, or transactional email test
   fails.

## Monitoring and Recovery

Review these queues daily during launch week and alert on failed rows or leases
that remain in `processing` beyond 20 minutes:

```sql
select id, event_type, status, attempt_count, last_error, updated_at
from public.processed_stripe_events
where status = 'failed'
   or (status = 'processing' and updated_at < now() - interval '20 minutes')
order by updated_at;

select job_key, job_type, status, attempt_count, last_error, updated_at
from public.bread_club_job_events
where status = 'failed'
   or (status = 'processing' and updated_at < now() - interval '20 minutes')
order by updated_at;

select job_key, order_id, status, attempt_count, available_at, last_error
from public.order_notification_jobs
where status <> 'completed'
order by available_at;

select id, provider_sync_revision, provider_sync_attempted_at,
  provider_sync_error, updated_at
from public.bread_club_memberships
where provider_sync_required
order by updated_at;

select id, membership_id, status, stripe_refund_status,
  refund_attempt_count, refund_last_error, updated_at
from public.bread_club_cycles
where status = 'refund_pending'
order by updated_at;

select id, membership_id, status, stripe_refund_status,
  refund_attempt_count, refund_last_error, updated_at
from public.bread_club_rollover_credits
where status = 'refund_pending'
order by updated_at;
```

Also monitor Render health/cron failures, Stripe webhook failures, Resend
delivery failures, Supabase connection saturation, and unusual growth in
`pending_approval`. Keep automated Supabase backups enabled, back up Storage
objects separately, and perform a database-plus-images restore drill into a
separate project at least quarterly and before major schema changes. A backup
is not proven until a restore has been tested. See Supabase's current backup
coverage and restore behavior: <https://supabase.com/docs/guides/platform/backups>.

## Remaining Hardening Roadmap

These items are deliberately recorded rather than hidden behind a “complete”
label:

1. Keep the backup/restore drill, production secret rotation, Cloudflare origin
   header rule, and Stripe/Resend webhook and delivery checks on the operating
   calendar. They are external controls and cannot be completed by a code
   deploy alone.
2. Add a CI job with a disposable full Supabase/PostgreSQL stack that applies
   every migration, runs concurrent inventory/payment/refund tests, verifies
   real grants, builds a second database from `schema.sql`, and compares the two
   catalogs. Local PostgreSQL migration tests do not reproduce every hosted
   Supabase extension and platform setting.
3. Add revision numbers/expected-revision checks to the remaining stale-tab
   editors, including menu, global delivery settings, and delivery windows, so
   simultaneous admins receive an explicit conflict instead of
   last-write-wins. Add idempotency keys to any remaining create-menu or
   create-slot retry path.
4. Add an operator reconciliation screen for failed jobs, payment exceptions,
   queued emails, and Stripe/database mismatches, with safe retry buttons and
   alerting.
5. Extend the durable retry/outbox pattern beyond Delivered notifications to
   non-completion order-status emails and customer replies. Replies have a
   deterministic provider idempotency key and a recorded failed state today,
   but neither message type has the completion outbox's automatic recovery.
6. Add authenticated desktop/mobile admin browser tests and measured production
   performance coverage. Static, build, and Playwright checks do not replace
   authenticated workflow coverage or field measurements of LCP, INP, CLS,
   and network waterfalls.
