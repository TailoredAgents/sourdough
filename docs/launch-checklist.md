# Luna & Lorelai's Sourdough Launch Checklist

Current status: repo is pushed, Supabase schema exists in the live database, seed data has been applied, the public storefront reads from Supabase with local fallback data for development, `/admin` is protected by Supabase Auth, admin tools can edit products, product photos, weekly menus, inventory, delivery settings, delivery windows, customer requests, approved AI knowledge, and order statuses, Resend is configured for app email, ZIP-allowlist delivery is implemented, and checkout can create pending Supabase orders before Stripe redirect once Stripe keys are configured.

## Phase 1: Supabase Foundation

- [x] Create Supabase project
- [x] Add Supabase credentials to `.env.local`
- [x] Run schema in Supabase
- [x] Verify tables exist
- [x] Seed Supabase with starter data: products, weekly menu, delivery windows, delivery settings, AI knowledge
- [x] Add a real database access layer for public storefront reads
- [x] Replace public storefront/static route reads with Supabase reads
- [x] Add admin-only Supabase queries/mutations for orders

## Phase 2: Admin Security

- [ ] Enable/configure Supabase Auth email settings in the Supabase dashboard
- [ ] Create owner/admin login account
- [x] Protect `/admin`
- [x] Protect admin API routes like `/api/admin/draft`
- [x] Add owner role/profile check so only approved accounts can manage the bakery
- [x] Add logout/session handling
- [x] Add friendly not-authorized page

## Phase 3: Admin Functionality

- [x] Product editor: name, category, description, ingredients, allergens, price, active status
- [x] Product image upload/storage
- [x] Weekly menu builder
- [x] Weekly menu create/clone flow
- [x] Inventory limits per product per week
- [x] Delivery window editor
- [x] Delivery settings editor: radius, fee, center point
- [x] Order dashboard with statuses
- [x] Customer message/last-minute request inbox
- [x] AI knowledge editor with approve/unapprove toggle
- [x] AI draft copy workflow

## Phase 4: Real Checkout

- [x] Create customer record during checkout
- [x] Create pending order before Stripe redirect
- [x] Create order items from selected cart
- [x] Reserve inventory before redirecting to Stripe
- [x] Prevent overselling with a database transaction/RPC
- [x] Store Stripe checkout session ID on order
- [x] Send real customer confirmation after payment
- [x] Send bakery owner notification after payment
- [x] Handle checkout cancellation
- [x] Release inventory when checkout expires
- [x] Make success page show real order confirmation details
- [x] Make editable `weekly_menus.order_cutoff_at` drive checkout open/closed behavior

## Phase 5: Stripe Webhooks

- [ ] Configure Stripe test keys
- [ ] Sync Supabase products into the Stripe test catalog
- [ ] Configure local webhook testing with Stripe CLI
- [ ] Configure deployed webhook URL
- [x] On `checkout.session.completed`: mark order paid, finalize inventory, send customer email
- [x] On `checkout.session.expired`: release inventory and mark order canceled/expired
- [x] Make webhook handling idempotent so duplicate Stripe events are safe
- [x] Add logging for failed webhook handling

## Phase 6: Delivery

- [x] Replace city-estimate delivery logic with a ZIP allowlist
- [x] Decide exact launch method: ZIP allowlist
- [x] Validate state and ZIP eligibility together
- [x] Store delivery eligibility on order
- [x] Prevent checkout outside Georgia
- [x] Add owner-editable delivery copy and service area
- [x] Add delivery instructions field to order records

## Phase 7: AI Guardrails

- [x] Move AI knowledge from static file to Supabase
- [x] Customer chat reads only approved `ai_knowledge_entries`
- [x] Customer chat includes current Supabase menu and inventory
- [x] Add refusal tests for unsupported allergen, legal, medical, and custom-order claims
- [x] Add rate limiting or abuse protection
- [x] Add contact-bakery escalation path
- [x] Protect admin drafting endpoint behind auth

## Phase 8: Emails

- [x] Configure Resend API key
- [x] Verify sending domain for `landlsourdough.com`
- [x] Add admin-only app-path test email endpoint
- [x] Create polished customer order confirmation template
- [x] Create owner new-order notification template
- [x] Create last-minute request notification template
- [x] Create order status update template
- [x] Add email failure logging

## Phase 9: Compliance And Business Readiness

- [ ] Confirm Georgia cottage food license/training requirements
- [ ] Confirm Canton/Cherokee home business or occupational tax requirements
- [ ] Confirm sales tax requirements with accountant
- [ ] Finalize required cottage food label text
- [x] Add required allergen and cottage-food disclaimers to product/order pages
- [x] Add refund/cancellation policy
- [x] Add privacy policy
- [x] Add terms/order policy
- [ ] Decide whether customer pickup will ever be offered or delivery-only

## Phase 10: Launch And Deployment

- [x] Add Render Blueprint `render.yaml`
- [x] Add Render production environment variable checklist
- [x] Add Vitest and Playwright launch smoke tests
- [ ] Create Render Blueprint service
- [ ] Add all `sync: false` environment variables to Render
- [ ] Connect `landlsourdough.com`
- [ ] Configure Supabase production URL keys
- [ ] Configure Stripe live keys only after test checkout passes
- [ ] Sync Supabase products into the Stripe live catalog after switching live keys
- [ ] Configure Stripe webhook secret in Render
- [x] Configure Resend DNS records
- [ ] Run admin email smoke test in production
- [ ] Run mobile/desktop visual check
- [ ] Run complete test order
- [ ] Run failed payment/canceled checkout test
- [ ] Run sold-out inventory test
- [ ] Run expired checkout inventory-release test

## Recommended Next Step

Finish the external launch tasks next: create/test the owner Supabase Auth account, confirm Render production environment variables, add Stripe test keys/webhook secret, and run a full test checkout.
