# 10/10 Launch Proof And Growth Roadmap

This document defines what must be proven before calling Luna & Lorelai's
Sourdough a true 10/10 ready-to-ship customer website, plus the next upgrades
that would make it stronger after launch.

## Current Local Readiness

The local codebase now covers the core customer journey:

- Customer-facing copy is written for buyers, not internal bakery operations.
- Weekly menu cards show photos, prices, quantities, allergens, and best-use guidance.
- Product detail pages include ingredients, allergens, serving ideas, storage tips, delivery context, and final CTAs.
- Checkout has item selection, delivery ZIP check, visible readiness steps, customer validation, required allergen/terms acknowledgement, selected-item summary, sticky mobile review CTA, and secure-checkout/request states.
- Homepage and local delivery pages let customers check ZIP eligibility before filling the full checkout form.
- Canton delivery SEO page includes local delivery copy, FAQ schema, menu links, ZIP checker, bake-alert signup, and final order CTA.
- Contact page gives customers a clear support route for order, delivery, ingredient, and preorder questions.
- Success and canceled checkout pages give customers next steps instead of leaving them stranded.
- Admin product editing includes launch photo standards for real product photos, consistent framing, and clean menu-card crops.
- Analytics events are emitted for page views, navigation, product detail clicks, item choice, cart changes, delivery checks, checkout/request starts, bake alerts, and customer questions.
- Google Analytics, Google Tag Manager, and Plausible can be enabled through public env vars without code changes.
- Sitemap, robots, OpenGraph/Twitter metadata, product pages, local landing page, policies, and contact page are in place.
- Playwright smoke coverage checks the mobile customer funnel, delivery checker, contact page, success/cancel pages, and core public routes.

## Proof Required Before Calling It 10/10

These items require real production accounts, live domain state, real content, or business confirmation.

- **Production deployment:** `https://landlsourdough.com` loads with no TLS errors, and `https://www.landlsourdough.com` redirects to the apex domain.
- **Environment variables:** Render has every required `sync: false` value from `render.yaml` and `docs/render-deployment.md`.
- **Supabase Auth:** Owner account can sign into `/admin`; unauthorized users cannot access admin pages or admin API routes.
- **Stripe test checkout:** A full test order succeeds, records the pending order, redirects to Stripe, marks paid on webhook completion, finalizes inventory, and shows the real success page.
- **Stripe cancel/expiry:** Canceled and expired checkout sessions release reserved inventory and show a useful customer recovery path.
- **Email delivery:** Resend sends customer confirmation, owner notification, last-minute request, and order status update emails from the production domain.
- **Inventory safety:** A sold-out item cannot be purchased from concurrent checkouts or stale pages.
- **Delivery safety:** Ineligible ZIPs cannot checkout or submit after-cutoff availability requests.
- **Real product media:** Replace generated/interim product imagery with real bakery photos that match the actual delivered products.
- **Customer trust:** Add real reviews or testimonials only after they exist; do not use placeholder or invented reviews.
- **Compliance:** Confirm Georgia cottage-food labeling, Canton/Cherokee business requirements, and sales-tax setup with the appropriate official or professional source before launch.
- **Search setup:** Add real Google Search Console, Bing verification, analytics IDs, and submit the sitemap.
- **Visual QA:** Test homepage, product pages, checkout, contact, policies, success/cancel pages, and admin on mobile and desktop production URLs.

## Production Smoke-Test Script

Run this sequence on the live domain before taking real orders:

1. Open `/`, `/contact`, `/policies`, `/sourdough-delivery-canton-ga`, one `/menu/*` page, `/robots.txt`, and `/sitemap.xml`.
2. Confirm product photos load, no page has horizontal mobile overflow, and CTAs land below the sticky header.
3. Submit the Canton delivery ZIP checker with an eligible ZIP and an ineligible ZIP.
4. Start a checkout with one item, valid customer details, eligible ZIP, selected delivery window, and checked acknowledgement.
5. Complete Stripe test payment and verify order details on `/order/success`.
6. Confirm customer and owner emails arrived.
7. Start a second checkout, cancel it, and verify inventory is released.
8. Trigger or simulate an expired checkout and verify inventory is released.
9. Try an ineligible ZIP at checkout and confirm checkout remains blocked.
10. Sign into `/admin`, update a product or weekly menu in a safe test way, and confirm the storefront reflects it.
11. Submit a bake-alert signup and confirm it appears in the customer message workflow.
12. Ask the customer chat an unsupported allergy or medical-safety question and confirm it refuses rather than inventing an answer.

## Post-Launch Growth Ideas

These are not blockers for launch, but they would make the website more effective after real customers start using it.

- Add a review-request workflow after completed delivery, then publish only real customer quotes with permission.
- Add a pre-publish photo quality check that warns when product images are missing, too small, or not close to a 4:3 or 3:2 crop.
- Add an optional "best seller" or "limited bake" flag to the weekly menu once real sales data exists.
- Add a returning-customer reorder shortcut based on prior orders after privacy and account decisions are settled.
- Add a small delivery-day status page or SMS/email update flow for "baking", "out for delivery", and "delivered".
- Add more local SEO pages only when service areas expand beyond the current Canton-area ZIP list.
- Add event dashboards for menu views, item choices, delivery checks, checkout starts, checkout errors, and bake-alert signups.
- Add A/B tests for hero CTA wording only after baseline analytics data exists.
- Add seasonal landing pages for holiday bread drops, gift bundles, or limited weekly flavors.
- Add a structured photo/review capture process after each bake so content quality improves every week.

## Definition Of Done

Call the site 10/10 only when:

- `npm run validate` passes locally and in CI,
- `npm run smoke:live` passes against `https://landlsourdough.com`,
- real product photos are live,
- legal/compliance requirements have been confirmed,
- payment and email flows work in production,
- search/analytics verification is installed,
- and customer-facing copy, policies, contact, ordering, checkout, and post-checkout pages are all verified on mobile and desktop.
