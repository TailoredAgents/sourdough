# Cloudflare deployment

The application runs on Cloudflare Workers with OpenNext. Supabase remains the
database, authentication provider, and product image store. Stripe, Resend,
Google Routes, and OpenAI retain their existing integrations and credentials.

## Resources

| Resource | Purpose |
| --- | --- |
| `landl-sourdough` Worker | Next.js pages, admin, API routes, and Stripe webhooks |
| `landl-bakery-operations` Worker | Hourly maintenance, minute 7 of every hour UTC |
| `landl-sourdough-cache` R2 bucket | Next.js incremental cache |
| `landl-sourdough-cache-tags` D1 database | Cache invalidation tags; no business records |
| `NEXT_CACHE_DO_QUEUE` Durable Object | Coordinates cache revalidation |
| `IMAGES` binding | Image optimization |

Wrangler configuration declares all bindings and the production account.
The operations Worker calls the storefront through the `STOREFRONT` service
binding and authenticates with `CRON_SECRET`. It has no public HTTP endpoint.
The storefront uses Cloudflare's visitor IP header for rate limiting.

## Secrets and public build settings

Use `.env.example` and `npm run check:prod-env -- --no-env-file` to check the
complete environment contract. The storefront's production values live in
Cloudflare Worker secrets. The operations Worker needs only the same
`CRON_SECRET`. Do not put production secrets in Git, workflow files, command
arguments, build artifacts, or chat.

For bulk provisioning, use a private JSON file outside the repository containing
an object of environment variable names and string values:

```bash
npx wrangler secret bulk /private/path/storefront-secrets.json
npx wrangler secret bulk /private/path/cron-secrets.json --config wrangler.cron.jsonc
```

Use `npx wrangler secret put NAME` to rotate individual secrets interactively.
Rotate `CRON_SECRET` in both Workers together. The old Render origin-header
secret is unnecessary when `DEPLOYMENT_PLATFORM=cloudflare`.

`NEXT_PUBLIC_*` values are embedded in browser bundles during build. Configure
the Supabase URL and public anon key as GitHub repository variables
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Optional analytics
and site-verification variables use the same names as `.env.example`.
Never use a Supabase service-role key as the public anon key.

Build in a clean checkout without `.env.local` or production server secrets.
The build needs public settings only. Supplying live server credentials during
a build can execute database-backed page rendering and menu maintenance.
Keep `NEXT_PUBLIC_SITE_URL=https://www.landlsourdough.com`.

## Automatic deployments

`.github/workflows/validate.yml` checks pull requests and pushes to `main`.
After validation succeeds for a push to `main`, `deploy-cloudflare.yml` checks
out that exact commit, builds with public repository variables, and deploys both
Workers. A final check skips commits superseded on `main`. Deployment jobs are
serialized. Pull requests do not receive the Cloudflare deployment credential.
Manual dispatch on `main` is available for recovery.

Create an API token at <https://dash.cloudflare.com/profile/api-tokens> using
the **Edit Cloudflare Workers** template. Include these permissions:

- Account: Workers Scripts **Edit**, Workers R2 Storage **Edit**, D1 **Edit**,
  and Account Settings **Read**.
- Zone: Workers Routes **Edit** and Zone **Read**.

Scope it to the production Cloudflare account and the `landlsourdough.com` zone.
Add it directly as the repository Actions secret `CLOUDFLARE_API_TOKEN` at
<https://github.com/TailoredAgents/sourdough/settings/secrets/actions>.
Cloudflare runtime secrets persist between code deployments; GitHub does not
need the application service credentials. Renew the token before its expiration.
The initial deployment token expires November 12, 2027 (America/New_York).

## Local checks and manual deployment

Use Node.js from `.node-version` (22 or a compatible newer release) and the
locked dependencies. Generate binding types before type checking or building:

```bash
npm ci --include=dev
npm run cf:typegen
npm run validate
npm run build:cloudflare
npx opennextjs-cloudflare preview
```

A production preview without server secrets intentionally reports unavailable
database-backed features. Use separate test credentials for local integration
tests. `npm run dev` supports the credential-free demo browser test suite.

Authenticate with `npx wrangler login` for a manual deployment, then:

```bash
npm run deploy:cloudflare
npm run deploy:cron
npm run check:cloudflare
```

For a freshly built bundle, `npx opennextjs-cloudflare deploy` avoids rebuilding.
Use OpenNext's deploy command to populate R2 and D1 cache data before publishing.
The temporary endpoint is `https://landl-sourdough.jeffrey-78e.workers.dev`.
Both production hostnames are declared as custom domains in `wrangler.jsonc`.

## Verification and recovery

Apply `supabase/migrations/20261112153000_fix_rate_limit_remaining.sql` to
existing databases before validating checkout and delivery. It fixes the
PostgreSQL `GREATEST` expression in the atomic rate limiter while retaining its
locking and execution grants. This migration was applied to production during
the Cloudflare transition; the canonical schema includes the same correction.

`npm run check:cloudflare` checks the hosting platform, pages, client assets,
image optimization, discovery metadata, and unauthenticated endpoint protection.
Override `DEPLOYMENT_URL` to check the temporary endpoint. Set `CRON_SECRET` in
the process environment to also check database connectivity and schema version.
The script never creates orders, charges cards, or sends messages.

Use `npx wrangler tail` for storefront logs and
`npx wrangler tail --config wrangler.cron.jsonc` for scheduled operations.
A successful scheduled event logs `bakery_operations_completed`. An HTTP or
application-level failure fails the scheduled event. Cloudflare's dashboard
also retains Worker logs and deployment versions.

Roll back code through the Worker's Deployments dashboard, or redeploy a known
good Git commit using the same public build settings. Code rollback does not
restore business data or revert secret rotations. Preserve Supabase backups
independently. R2 and D1 here are application caches, not business backups.

During the Render transition, verify the temporary Cloudflare endpoint first,
then attach the custom domains and verify their platform and database health.
Suspend the old Render cron before enabling the Cloudflare schedule to avoid
two schedulers. Preserve private Render service/environment backups before
deleting the old web service and cron. Historical Render instructions remain
in `render-deployment.md` for recovery only.
