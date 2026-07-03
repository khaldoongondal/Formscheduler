# Leadder Mission Control - Supabase Structure Draft

Source: `LGS-Growth-Dashboard-SOW-v2.docx`

## Recommendation

Supabase is the right starting point for V1 because the app is mostly an internal operating system with Postgres-shaped data: ad performance, funnel events, sales outcomes, client lifecycle, financial snapshots, and AI run logs.

One adjustment from the SOW: if Row Level Security is disabled, the browser should not query Supabase tables directly. Use Supabase from server routes/actions only, with cookie auth in Next.js as the app boundary. If we want client-side Supabase queries later, enable RLS before exposing table access.

## Data Layers

### 1. Attribution

Tables:

- `page_view_events`
- `ghl_contacts`
- `ghl_pipeline_events`
- `capi_event_log`

Purpose:

Capture anonymous traffic, attach it to real contacts, then track the sales journey from lead to booked call to shown call to closed client. This layer is the source of truth for "your data" CAC, ROAS, booking rate, and customer journey timelines.

Important joins:

- `page_view_events.visitor_id` -> `ghl_contacts.visitor_id`
- `page_view_events.fbclid` -> `ghl_contacts.fbclid`
- `ghl_contacts.ghl_contact_id` -> `ghl_pipeline_events.ghl_contact_id`
- `ghl_pipeline_events.id` -> `capi_event_log.source_event_id`

### 2. Marketing Performance

Tables:

- `meta_ad_performance`
- `funnel_events`

Purpose:

Store daily synced ad metrics and GA4 funnel step metrics. This is the comparison layer between Meta-reported metrics and internal conversion outcomes.

Important joins:

- `ghl_contacts.utm_campaign` -> `meta_ad_performance.campaign_name`
- `ghl_contacts.utm_content` -> `meta_ad_performance.ad_name`
- `creative_assets.linked_ad_id` -> `meta_ad_performance.ad_id`

### 3. Sales

Tables:

- `sales_metrics`

Purpose:

Daily per-rep sales performance. Store raw counts and dollar amounts only. Show rates, offer rates, close rates, commission, and revenue per offer should be computed in queries.

### 4. Client Success

Tables:

- `clients`
- `client_checklist_items`

Purpose:

Track active subscribers, onboarding progress, health score, churn signals, and client lifecycle. GHL remains the operational system; this database gives Mission Control a queryable product layer.

### 5. Financials

Tables:

- `expense_config`
- `cash_transactions`
- `monthly_kpi_snapshots`

Purpose:

Track configurable assumptions, synced cash transactions, and monthly P&L snapshots. The app should calculate live period metrics at query time, while `monthly_kpi_snapshots` stores month-end history and AI projections.

### 6. Creative + AI

Tables:

- `creative_assets`
- `competitor_observations`
- `ai_model_runs`

Purpose:

Connect creative decisions to ad performance and keep AI outputs auditable. Every AI run should store task type, model key, prompt, raw response, and structured JSON output.

### 7. Infrastructure

Tables:

- `sync_log`

Purpose:

Track cron health, manual sync runs, source freshness, record counts, and errors.

## First Build Slice

I would build the schema in this order:

1. Core enum/type setup and all tables.
2. Indexes for date-range dashboard queries.
3. Seed `expense_config` with business assumptions.
4. Create SQL views for dashboard query shapes.
5. Add server-only Supabase client helpers.
6. Add webhook/API routes that write to the schema.

## High-Risk Decisions To Confirm

- Currency: SOW uses CAD for CAPI Purchase. Store money as integer cents and default `currency = 'CAD'`.
- RLS: either server-only Supabase access with RLS disabled, or client-side Supabase with RLS enabled. I recommend server-only for V1.
- Sales source of truth: `sales_metrics` can be manually edited/imported, but should eventually be derived from `ghl_pipeline_events` where possible.
- Contact identity: `fbclid` first, then `visitor_id`, then email/IP fallback. We should keep fields for all signals, not collapse too early.
- Client lifecycle: GHL pipeline stage should drive `clients.status`, not payment webhooks in V1.

## Table Map

| Table | Grain | Primary Writer | Primary Readers |
| --- | --- | --- | --- |
| `page_view_events` | one browser pageview | browser pixel API | dashboard, journey timeline |
| `ghl_contacts` | one GHL contact | GHL webhook | attribution, clients |
| `ghl_pipeline_events` | one funnel stage event | GHL webhook | dashboard, sales, CAPI |
| `meta_ad_performance` | one ad per day | Meta cron | dashboard, creative |
| `funnel_events` | one page slug per day | GA4 cron | funnel waterfall |
| `sales_metrics` | one rep per day | GHL sync/manual import | sales, financials |
| `clients` | one customer account | GHL webhook/API writes | clients, financials |
| `creative_assets` | one creative unit | user/AI | creative, dashboard |
| `competitor_observations` | one competitor note | user | creative AI context |
| `expense_config` | one config value per scope | settings/user | financials, AI |
| `cash_transactions` | one Tiller transaction | Sheets cron | financials |
| `monthly_kpi_snapshots` | one month per snapshot type | monthly cron/AI | financials, AI |
| `ai_model_runs` | one AI task execution | AI service | all AI panels |
| `capi_event_log` | one Meta CAPI send attempt | CAPI sender | audit log |
| `client_checklist_items` | one checklist item per client | app/GHL sync | clients |
| `sync_log` | one sync run | cron/manual sync | settings |
