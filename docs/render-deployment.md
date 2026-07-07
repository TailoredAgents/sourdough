# Render Deployment

L&L Sourdough deploys to Render as a Node web service because the app uses
Next.js server rendering, API routes, Supabase Auth cookies, Stripe webhooks,
and admin mutations.

## Render Service

Use the `render.yaml` Blueprint in the repo root.

- Service type: `web`
- Runtime: `node`
- Instance type: `standard`
- Build command: `npm ci && npm run build`
- Start command: `npm run start`
- Health check path: `/api/health`
- Node version: `.node-version` pins Node 22

## Required Render Environment Variables

Values with `sync: false` in `render.yaml` must be entered in Render manually.
Do not commit real secret values.

| Key | Production value |
| --- | --- |
| `NODE_ENV` | `production` |
| `NEXT_PUBLIC_SITE_URL` | `https://landlsourdough.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `SUPABASE_DB_URL` | Supabase direct database connection string |
| `ADMIN_EMAILS` | Comma-separated owner emails |
| `RESEND_API_KEY` | Resend API key, blank until email is configured |
| `RESEND_FROM` | `L&L Sourdough <orders@landlsourdough.com>` |
| `BAKERY_EMAIL` | Owner/order notification email |
| `OPENAI_API_KEY` | OpenAI API key, blank to use fallback replies |
| `OPENAI_MODEL` | `gpt-5.4-mini` |
| `STRIPE_SECRET_KEY` | Blank until Stripe setup is ready |
| `STRIPE_WEBHOOK_SECRET` | Blank until Stripe webhook is ready |
| `DELIVERY_CENTER_LAT` | `34.2368` |
| `DELIVERY_CENTER_LNG` | `-84.4908` |
| `DELIVERY_RADIUS_MILES` | `12` |
| `DELIVERY_FEE_CENTS` | `600` |

The Blueprint explicitly sets `plan: standard`, one tier above Render's
default `starter` instance type for new web services.

## Deployment Steps

1. In Render, create a new Blueprint from `TailoredAgents/sourdough`.
2. Confirm the service is created from `render.yaml`.
3. Enter all `sync: false` environment variables in Render.
4. Deploy once using the default Render URL.
5. In Supabase Auth settings, add the Render URL and later `https://landlsourdough.com` to allowed redirect URLs.
6. After the first successful deploy, connect `landlsourdough.com` in Render custom domains.
7. Update DNS at the domain registrar using Render's shown DNS records.
8. After DNS is live, confirm `NEXT_PUBLIC_SITE_URL=https://landlsourdough.com`.
9. Run the smoke tests below.

## Smoke Tests

- Visit `/` and confirm the storefront loads.
- Visit `/policies` and confirm policy pages load.
- Visit `/api/health` and confirm it returns JSON with `"ok": true`.
- Visit `/admin/login` and request a magic link for an approved admin email.
- Confirm product photos load from Supabase Storage.
- Confirm the delivery radius check works.
- Leave Stripe keys blank until LLC/EIN/Stripe setup is ready.

## Stripe Later

When Stripe is ready:

1. Add `STRIPE_SECRET_KEY` in Render.
2. Create a Stripe webhook endpoint for:
   - `https://landlsourdough.com/api/stripe/webhook`
3. Listen for:
   - `checkout.session.completed`
   - `checkout.session.expired`
4. Add `STRIPE_WEBHOOK_SECRET` in Render.
5. Run a full Stripe test checkout before switching to live keys.
