# Reference Code Reuse Plan

Sources:

- SOW: `/Users/maltais/Downloads/LGS-Growth-Dashboard-SOW-v2.docx`
- Transcript supplied by Adam in chat
- Evernude reference code: `_reference/evernude-attribution-main`

## What To Reuse From Evernude

### `utils/hash.js`

Reuse almost directly as `lib/hash.ts`.

Why it matters:

- Normalizes PII before hashing.
- Produces SHA-256 hashes for Meta CAPI.
- Builds `fbc` from `fbclid` in Meta's expected format.

Changes:

- Convert CommonJS to TypeScript exports.
- Add phone hashing support for GHL contacts.
- Keep behavior identical for email, first name, last name, IP, user agent, `fbc`, and `fbp`.

### `services/meta-capi.js`

Port as `lib/meta-capi.ts`.

Why it matters:

- Correct Meta CAPI payload shape.
- Correct `user_data` structure.
- Correct dedup `event_id` usage.
- Clean success/error response handling.

Changes:

- Replace `axios` with native `fetch`.
- Replace ecommerce event map with LGS funnel events:
  - `Lead`
  - `Schedule`
  - `AppointmentShown`
  - `Purchase`
- Add `custom_data` for `Purchase`: `{ value: 297, currency: "CAD" }`.
- Write every attempt to `capi_event_log`.
- Check `ghl_pipeline_events.capi_sent` before sending duplicates.

### `routes/events.js`

Port the pattern, not the route itself.

Use it for:

- Request validation.
- Idempotent inserts using `event_id`.
- Capturing `fbclid`, `fbc`, `fbp`, UTMs, IP, user agent.
- Async CAPI send after database insert.

Changes:

- Implement as Next.js route `app/api/events/pageview/route.ts`.
- Target `page_view_events`, not Evernude's generic `events` table.
- Include `visitor_id` from ThumbmarkJS.
- Track LGS funnel events:
  - page view
  - VSL CTA click
  - opt-in
  - booking
- Feed daily aggregate counts into `funnel_events` where useful.

### `routes/webhook.js`

Reuse the HMAC verification pattern.

Why it matters:

- Raw-body HMAC verification is easy to get subtly wrong.
- Constant-time comparison is the right security shape.
- Idempotent webhook processing is already modeled.

Changes:

- Replace Shopify HMAC header/secret logic with GHL webhook signature rules.
- Implement as `app/api/webhooks/ghl/route.ts`.
- Parse GHL contact, appointment, and opportunity payloads.
- Upsert into `ghl_contacts`, `ghl_pipeline_events`, and `clients`.
- Trigger CAPI events from GHL funnel stages.

### `public/shopify-pixel.js`

Reuse the browser-side capture concepts.

Useful pieces:

- UTM cookie persistence.
- `fbclid` persistence.
- `fbc` construction.
- `navigator.sendBeacon` fallback to `fetch`.
- Short dedup window.

Changes:

- Remove all Shopify add-to-cart/checkout interception.
- Add ThumbmarkJS fingerprint generation.
- Fire LGS-specific events:
  - `PageView` on VSL load
  - `CTA_Click` on VSL CTA
  - `OptIn` on popup form submit
  - `Booking` on booking page/thank-you flow if available
- Keep script async and non-blocking.

## What Not To Reuse From Evernude

- Static HTML dashboard UI.
- Dark/ecommerce visual language.
- Shopify schema.
- Shopify webhook payload parsing.
- Raw `pg` database layer as the main database adapter.

The new app should use Next.js 14, Supabase, TypeScript, and the FinTracker light UI.

## What To Reuse From AKM / FinTracker

The AKM repo is not currently present in this workspace. When available, use it for:

- Supabase client setup.
- Cookie auth pattern.
- Vercel cron route style.
- Google Sheets service account sync for Tiller.
- Hash-based dedup for synced rows.
- AI context injection pattern.
- Persistent AI chat/memory pattern if still desired.
- FinTracker light design system implementation.

## Product Layers Confirmed By Transcript

### 1. Creative Mission Control

- Competitor observations.
- Hooks, angles, mechanisms, offers library.
- AI-assisted copy builder.
- Status flow: idea -> draft -> final -> in build -> live -> retired.
- Link live creative back to Meta ad performance.

### 2. Ad Attribution + Funnel Tracking

- Meta ad-level spend and reported metrics.
- GHL lead, booked, shown, closed events.
- Page-level GA4 uniques.
- Custom pixel funnel events.
- Customer journey timeline.
- CAPI audit log.
- Drill levels: sources, campaigns, medium/adsets, ads.

### 3. Sales Tracking

- One-call-close funnel.
- Intro calls, live intros, offers, deposits, closes.
- Team total row.
- Team average per active rep row.
- Commission tiers from `expense_config`, never hardcoded.

### 4. Financials

- Double-protected route.
- MRR, churn, net new, CAC, LTV:CAC, payback, margin.
- Expense defaults, monthly overrides, and actuals.
- Tiller/Google Sheets cash transactions.
- AI projections, scenarios, anomalies, and insights.

### 5. Client Success

- Client lifecycle from GHL.
- Onboarding checklist.
- Health score.
- Two-way writes back to GHL.
- Churn reason, months active, LTV to date.

## Important Build Decisions

- Use a fresh Supabase project and fresh GitHub repo.
- Keep RLS disabled only if all Supabase access is server-side.
- Individual rep calendars under one GHL round robin calendar.
- Meta ad URL template:
  `utm_source=meta&utm_medium=paid-social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}`
- GHL hidden attribution fields are required on the opt-in form.
- Store money as integer cents in database tables.
- Store all raw webhook/API payloads in `jsonb` for debugging.
- Every page and query must accept `date_from` and `date_to`.
- Every Next.js page/API route should be dynamic/no-store.

