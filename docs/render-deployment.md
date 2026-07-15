# Render Deployment

Luna & Lorelai's Sourdough deploys to Render as a Node web service because the app uses
Next.js server rendering, API routes, Supabase Auth cookies, Stripe webhooks,
and admin mutations.

## Render Service

Use the `render.yaml` Blueprint in the repo root.

- Service type: `web`
- Runtime: `node`
- Instance type: `standard`
- Build command: `npm ci --include=dev && npm run build`
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
| `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | Google Search Console verification token, blank until available |
| `NEXT_PUBLIC_BING_SITE_VERIFICATION` | Bing Webmaster Tools verification token, blank until available |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | Google Analytics measurement ID, blank unless GA is used |
| `NEXT_PUBLIC_GTM_ID` | Google Tag Manager container ID, blank unless GTM is used |
| `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` | Plausible domain, blank unless Plausible is used |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `SUPABASE_DB_URL` | Supabase direct database connection string |
| `ADMIN_EMAILS` | Comma-separated owner emails |
| `RESEND_API_KEY` | Resend API key for app-sent customer and owner emails; production email sends fail closed when blank |
| `RESEND_FROM` | `Luna & Lorelai's Sourdough <orders@landlsourdough.com>` |
| `BAKERY_EMAIL` | `orders@landlsourdough.com` or another monitored owner/order inbox |
| `OPENAI_API_KEY` | OpenAI API key, blank to use fallback replies |
| `OPENAI_MODEL` | `gpt-5-mini` |
| `STRIPE_SECRET_KEY` | Stripe secret key before accepting paid orders; blank keeps production checkout unavailable |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret before accepting paid orders |
| `DELIVERY_FEE_CENTS` | `600` |
| `DELIVERY_ALLOWED_POSTAL_CODES` | `30114,30115,30107,30183` fallback when Supabase is unavailable |
| `DELIVERY_SERVICE_AREA_COPY` | Fallback service area copy when Supabase is unavailable |

The public verification and analytics keys are listed in the Blueprint so they
are visible during production setup. They can remain blank until the matching
service is configured. Supabase service credentials are required for production
storefront data; local sample menu data is disabled in production when Supabase
is unavailable. Customer-facing rate limits also fail closed in production when
Supabase rate-limit storage is unavailable. The Blueprint explicitly sets
`plan: standard`, one tier above Render's default `starter` instance type for
new web services.

## Deployment Steps

1. In Render, create a new Blueprint from `TailoredAgents/sourdough`.
2. Confirm the service is created from `render.yaml`.
3. Enter all `sync: false` environment variables in Render.
4. Deploy once using the default Render URL.
5. In Supabase Auth settings, add the Render URL and later `https://landlsourdough.com` to allowed redirect URLs.
6. After the first successful deploy, connect `landlsourdough.com` in Render custom domains.
7. Update DNS at the domain registrar using Render's shown DNS records.
8. Confirm `https://landlsourdough.com` loads without TLS errors and `https://www.landlsourdough.com` redirects to the apex domain.
9. After DNS is live, confirm `NEXT_PUBLIC_SITE_URL=https://landlsourdough.com`.
10. Run `npm run check:prod-env`.
11. Run `npm run smoke:live`.

## Smoke Tests

Run the automated public smoke suite after DNS and TLS are live:

```bash
npm run smoke:live
```

`npm run smoke:live` runs `npm run check:domain` first, then runs Playwright
against `https://landlsourdough.com` only after the apex domain, `www`
redirect, health endpoint, and sitemap are ready.

If `npm run check:domain` reports TLS packet errors and diagnostics showing
HTTP redirects to a third-party warning page such as `safebrowse.io`, fix the
external DNS, proxy, or registrar forwarding first. The live smoke suite cannot
pass until `landlsourdough.com` and `www.landlsourdough.com` terminate HTTPS for
this Render site directly.

For the temporary Render URL before the custom domain is ready:

```bash
PLAYWRIGHT_BASE_URL=https://your-render-service.onrender.com npm run test:e2e
```

- Visit `/` and confirm the storefront loads.
- Visit `/policies` and confirm policy pages load.
- Visit `/api/health` and confirm it returns JSON with `"ok": true`.
- Visit `/admin/login` and sign in with an approved Supabase Auth email/password.
- Confirm product photos load from Supabase Storage.
- Confirm the delivery ZIP check works.
- While signed into admin, `POST /api/admin/email-test` and confirm Resend delivers from `orders@landlsourdough.com`.
- Confirm the admin email smoke test fails loudly if `RESEND_API_KEY` is intentionally blank.
- Confirm Stripe success/cancel URLs and any app-generated email links use `https://landlsourdough.com`.
- Leave Stripe keys blank until LLC/EIN/Stripe setup is ready. Production
  checkout stays unavailable while the Stripe secret key is blank.

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
