# Luna & Lorelai's Sourdough

Agentic retail bakery platform for `landlsourdough.com`, built for local sourdough delivery from Canton, GA.

## What Is Implemented

- Next.js App Router storefront with warm artisan design and generated hero photography.
- Weekly menu, limited quantities, bread plus add-ons, allergen display, and editable menu cutoff behavior.
- ZIP-allowlist local delivery check from Canton, GA with configurable fee, service-area copy, and allowed ZIPs.
- Stripe Checkout endpoint with demo fallback when Stripe keys are absent.
- Stripe webhook route for paid and expired checkout events.
- Resend-backed email helper with console/demo fallback when the API key is absent.
- Customer AI chat constrained to approved bakery facts, current menu data, inventory, and product/allergen data.
- Protected admin dashboard for product catalog, weekly menus, inventory, delivery windows, delivery settings, customer requests, AI knowledge, order statuses, and AI drafting.
- Supabase schema for products, menus, orders, customers, delivery settings, email logs, rate limits, messages, and AI knowledge.

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

The app works in demo mode without secrets. Copy `.env.example` to `.env.local` when you are ready to connect real services.

## Environment Variables

Required before live launch:

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_EMAILS`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`
- `RESEND_FROM`
- `BAKERY_EMAIL`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `DELIVERY_RADIUS_MILES`
- `DELIVERY_FEE_CENTS`
- `DELIVERY_ALLOWED_POSTAL_CODES`
- `DELIVERY_SERVICE_AREA_COPY`

Use `.env.example` as the complete template. Real values belong in
`.env.local` locally and in Render's Environment tab for production. Do not
commit `.env.local`.

## Render Deployment

This repo is prepared for Render deployment with `render.yaml`.

Render service settings:

- Type: Node web service
- Instance type: `standard`
- Build command: `npm ci --include=dev && npm run build`
- Start command: `npm run start`
- Health check path: `/api/health`
- Node version: `.node-version`

Detailed deployment steps and the production env var checklist are in
`docs/render-deployment.md`.

## Supabase

Run `supabase/schema.sql` in a Supabase project SQL editor or with `psql`, then run `supabase/seed.sql` to load the starter products, weekly menu, delivery windows, delivery settings, and approved AI knowledge.

The public storefront reads from Supabase when the Supabase environment variables are configured. Local fallback data remains in `src/lib/bakery-data.ts` so the app can still be reviewed without credentials. Admin pages and admin API routes are protected by Supabase Auth and approved owner email checks.

## Admin Access

`/admin` is protected by Supabase Auth. Add approved owner emails to `ADMIN_EMAILS` as a comma-separated list:

```env
ADMIN_EMAILS=owner@example.com
```

Create the admin user in Supabase Auth with an email and password, then add
that same email to `ADMIN_EMAILS`. The login page uses Supabase password auth;
approved admins can also be added later through the `admin_users` table.

## Stripe

The checkout route uses Stripe Checkout Sessions for one-time payments. Without `STRIPE_SECRET_KEY`, checkout redirects to a demo success page and logs email output instead of collecting money.

Products are synced from Supabase into Stripe Products and one-time Prices. After
editing product names, descriptions, active status, or prices, run:

```bash
npm run stripe:sync-catalog
```

Checkout uses the synced Stripe Price ID when it matches the current Supabase
price, with inline price data as a fallback while a product is unsynced.

Webhook path:

```text
/api/stripe/webhook
```

Listen for:

- `checkout.session.completed`
- `checkout.session.expired`

## OpenAI

The customer chat and admin drafting routes use the Responses API through the `openai` package when `OPENAI_API_KEY` is present. Without a key, both routes return deterministic fallback text so the UI remains testable.

## Pre-Launch Checklist

- Confirm Georgia cottage food training, operating rules, and required labels.
- Confirm Canton/Cherokee home-business or occupational tax requirements.
- Confirm sales tax setup with an accountant.
- Create and test the owner Supabase Auth account.
- Configure Stripe live keys and webhook secret.
- Sync the active Supabase product catalog into Stripe.
- Send a real Resend email from the admin smoke-test path in production.
- Configure Stripe test keys and webhook secret, then run full checkout, cancellation, expiry, and sold-out tests.
- Test mobile, desktop, Stripe test cards, expired checkouts, emails, and AI refusal behavior.
