# L&L Sourdough Launch Checklist

Current status: repo is pushed, Supabase schema exists in the live database, seed data has been applied, the public storefront reads from Supabase with local fallback data, and `/admin` is protected by Supabase Auth.

## Phase 1: Supabase Foundation

- [x] Create Supabase project
- [x] Add Supabase credentials to `.env.local`
- [x] Run schema in Supabase
- [x] Verify tables exist
- [x] Seed Supabase with starter data: products, weekly menu, delivery windows, delivery settings, AI knowledge
- [x] Add a real database access layer for public storefront reads
- [x] Replace public storefront/static route reads with Supabase reads
- [ ] Add admin-only Supabase queries/mutations for products, menus, inventory, delivery windows, orders, and AI knowledge

## Phase 2: Admin Security

- [ ] Enable/configure Supabase Auth email settings in the Supabase dashboard
- [ ] Create owner/admin login account
- [x] Protect `/admin`
- [x] Protect admin API routes like `/api/admin/draft`
- [x] Add owner role/profile check so only approved accounts can manage the bakery
- [x] Add logout/session handling
- [x] Add friendly not-authorized page

## Phase 3: Admin Functionality

- [ ] Product editor: name, category, description, ingredients, allergens, price, active status
- [ ] Product image upload/storage
- [ ] Weekly menu builder
- [ ] Inventory limits per product per week
- [ ] Delivery window editor
- [ ] Delivery settings editor: radius, fee, center point
- [ ] Order dashboard with statuses
- [ ] Customer message/last-minute request inbox
- [ ] AI knowledge editor with approve/unapprove toggle
- [ ] AI draft history or copy/send workflow

## Phase 4: Real Checkout

- [ ] Create customer record during checkout
- [ ] Create pending order before Stripe redirect
- [ ] Create order items from selected cart
- [ ] Reserve inventory before redirecting to Stripe
- [ ] Prevent overselling with a database transaction/RPC
- [ ] Store Stripe checkout session ID on order
- [ ] Send real customer confirmation after payment
- [ ] Send bakery owner notification after payment
- [ ] Handle checkout cancellation
- [ ] Release inventory when checkout expires
- [ ] Make success page show real order confirmation details

## Phase 5: Stripe Webhooks

- [ ] Configure Stripe test keys
- [ ] Configure local webhook testing with Stripe CLI
- [ ] Configure deployed webhook URL
- [ ] On `checkout.session.completed`: mark order paid, finalize inventory, send emails
- [ ] On `checkout.session.expired`: release inventory and mark order canceled/expired
- [ ] Make webhook handling idempotent so duplicate Stripe events are safe
- [ ] Add logging for failed webhook handling

## Phase 6: Delivery

- [ ] Replace city-estimate delivery logic with a reliable rule
- [ ] Decide exact launch method: ZIP allowlist, radius geocoding, or manual approval
- [ ] Validate street/city/state/ZIP together
- [ ] Store delivery mileage/eligibility on order
- [ ] Prevent checkout outside Georgia
- [ ] Add owner-editable delivery copy and service area
- [ ] Add delivery instructions field to order records

## Phase 7: AI Guardrails

- [ ] Move AI knowledge from static file to Supabase
- [ ] Customer chat reads only approved `ai_knowledge_entries`
- [ ] Customer chat includes current Supabase menu and inventory
- [ ] Add refusal tests for unsupported allergen, legal, medical, and custom-order claims
- [ ] Add rate limiting or abuse protection
- [ ] Add contact-bakery escalation path
- [ ] Protect admin drafting endpoint behind auth

## Phase 8: Emails

- [ ] Configure Resend API key
- [ ] Verify sending domain for `landlsourdough.com`
- [ ] Create customer order confirmation template
- [ ] Create owner new-order notification template
- [ ] Create last-minute request notification template
- [ ] Create order status update template
- [ ] Add email failure logging

## Phase 9: Compliance And Business Readiness

- [ ] Confirm Georgia cottage food license/training requirements
- [ ] Confirm Canton/Cherokee home business or occupational tax requirements
- [ ] Confirm sales tax requirements with accountant
- [ ] Finalize required cottage food label text
- [ ] Add required allergen and cottage-food disclaimers to product/order pages
- [ ] Add refund/cancellation policy
- [ ] Add privacy policy
- [ ] Add terms/order policy
- [ ] Decide whether customer pickup will ever be offered or delivery-only

## Phase 10: Launch And Deployment

- [ ] Create Vercel project
- [ ] Add all environment variables to Vercel
- [ ] Connect `landlsourdough.com`
- [ ] Configure Supabase production URL keys
- [ ] Configure Stripe live keys only after test checkout passes
- [ ] Configure Stripe webhook secret in Vercel
- [ ] Configure Resend DNS records
- [ ] Run mobile/desktop visual check
- [ ] Run complete test order
- [ ] Run failed payment/canceled checkout test
- [ ] Run sold-out inventory test
- [ ] Run expired checkout inventory-release test

## Recommended Next Step

Finish Phase 2 external setup next by setting `ADMIN_EMAILS` and confirming Supabase Auth magic-link email settings. After that, start Phase 3 admin functionality.
