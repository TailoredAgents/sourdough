# Sunday Bread Club Launch Runbook

Public enrollment must remain disabled until every item in the final gate is
complete. The disabled deployment still supports owner enrollment tests through
`/bread-club?preview=1` while signed in to the admin account.

## Production Controls

| Setting | Prelaunch value |
| --- | --- |
| `BREAD_CLUB_PUBLIC_ENABLED` | `false` |
| `STRIPE_AUTOMATIC_TAX_ENABLED` | `false` until Georgia registration and the ship-from address are confirmed |
| `BREAD_CLUB_TAX_STATUS` | `pending` until tax treatment is confirmed |
| `ADMIN_EMAILS` | Approved owner emails that can run the live smoke test |
| `CRON_SECRET` | One strong shared value, entered identically on the Render web and cron services |

The checkout API enforces these controls server-side. A preview checkout
requires an authenticated admin session, and checkout is locked to that
signed-in email.

## Deployment Order

1. Snapshot Bread Club, product, weekly menu, window, order, and email-event row
   counts.
2. Apply `supabase/migrations/20260726090000_bread_club.sql` transactionally.
3. Run the Bread Club Stripe synchronization. Confirm three plan Products,
   three recurring plan Prices, one delivery Product, and three recurring
   delivery Prices. All recurring Prices must use a four-week interval.
4. Run the protected setup endpoint to create or update the production webhook
   and Billing Portal. This also records `BREAD_CLUB_TAX_STATUS` in Supabase.
5. Put the newly returned webhook signing secret in Render as
   `STRIPE_WEBHOOK_SECRET`. Never commit it.
6. Confirm the deployed webhook accepts a signed Stripe test event after
   Render has the matching secret. Do not accept live checkout traffic during
   any secret-copy gap.
7. Deploy the web service and hourly operations cron from `render.yaml`.
8. Run `npm run check:prod-env`, `npm run validate`, and the live read-only
   smoke suite.

## Owner Smoke Test

Sign in to `/admin` with an approved owner email.

1. Open `/bread-club?preview=1`, select a plan, verify the address, and confirm
   the exact four-week plan and delivery total.
2. Complete one real subscription Checkout.
3. Confirm one membership, one paid cycle, four fulfillments, four paid orders,
   four inventory reservations, and four Sunday stop reservations.
4. Confirm the customer welcome email, owner alert, passwordless member access,
   Billing Portal, admin member view, ordinary order dashboard badges, and
   Sunday route inclusion.
5. Test one selection swap and restore it.
6. Test one skip, confirm inventory release, loaf rollover credit, and the
   negative delivery invoice item.
7. Cancel at period end, confirm already-paid Sundays remain, then perform the
   authorized refund and cleanup.

Record Stripe IDs and before/after database rows for the smoke test. Do not
delete Stripe financial history.

## Final Public Gate

- Georgia sales-tax treatment is recorded as `registered` or `exempt`.
- `STRIPE_AUTOMATIC_TAX_ENABLED` is `true` after the Georgia registration is active in Stripe Tax.
- The protected setup step was rerun after setting the final tax status, while
  public enrollment was still disabled.
- The owner smoke test and cleanup passed.
- The production webhook has no failed Bread Club events.
- The hourly operations cron completed once successfully.
- Stripe business public details include the monitored support email and
  `https://www.landlsourdough.com/contact` support URL.
- Product ingredient costs are entered where contribution reporting is needed.
- The previously exposed Stripe live secret has been rotated in Stripe,
  `.env.local`, and Render.

Only then set `BREAD_CLUB_PUBLIC_ENABLED=true` and redeploy. Monitor failed job
events, failed Stripe events, payment failures, and membership/order
mismatches for at least 24 hours. Setting the flag back to `false` immediately
removes public enrollment without affecting existing member management.
