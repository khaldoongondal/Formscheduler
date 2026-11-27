# FormBook production deployment

FormBook is made by Gondal Tech. Main production address: `https://app.formbook.ca`. `https://formbooking.gondaltech.app` is only an optional extra address: if it is attached, list it in `FORMBOOK_EXTRA_APP_ORIGINS` and in the redirect allow lists below.

Pushing `main` deploys production on Vercel. Production has no staging copy, so follow the checklist below in order and do not skip the backup.

## Sprint 4 release checklist

Sprint 4 adds the Plan page and upgrade path (checkout and billing on a GoHighLevel payment page in the owner's account, never in the app), the downgrade freeze and restore, plan history, the onboarding checklist, starter templates and in-editor preview, account lifecycle events sent to the owner's GoHighLevel account, the owner activation funnel, and the new public product page with SEO metadata. Follow the steps in order.

### 1. Prerequisite

The Sprint 2 and Sprint 3 checklists (below) must be completed first: migrations `0025` to `0031` applied in order and their smoke tests passed. Do not apply `0032` to `0034` to a database without `0025` to `0031`.

### 2. Back up production

Supabase dashboard: Database, Backups, take a manual backup (or run `pg_dump` against the production connection string and keep the file somewhere safe).

### 3. Apply the migrations in order

Run `0032_plan_changes_and_freeze.sql`, then `0033_onboarding.sql`, then `0034_lifecycle_sync.sql`. Each file is additive and safe to run twice. After each one, run its checks:

```sql
-- 0032
select count(*), count(distinct account_ref) from public.tenants;          -- the two numbers are equal
select count(*) from public.funnels where frozen_at is not null;            -- 0
select proname from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('apply_tenant_plan_change', 'swap_frozen_form', 'tenant_form_activity', 'tenant_pixel_activity');   -- 4 rows

-- 0033
select to_regclass('public.tenant_onboarding');                             -- not null

-- 0034
select count(*) from public.lifecycle_event_deliveries;                     -- 0 right after (the backfill queues nothing)
select first_connection_at, first_form_activated_at, first_lead_at, first_booking_at from public.tenants;   -- filled where data exists
select tgname from pg_trigger
where tgname like '%lifecycle%' and tgname not like 'lifecycle_event_deliveries%';   -- 7 rows

-- Grants (all false)
select has_table_privilege('authenticated', 'public.tenant_plan_changes', 'select'),
       has_table_privilege('authenticated', 'public.tenant_onboarding', 'select'),
       has_table_privilege('authenticated', 'public.lifecycle_event_deliveries', 'select'),
       has_table_privilege('anon', 'public.tenant_plan_changes', 'select'),
       has_table_privilege('anon', 'public.tenant_onboarding', 'select'),
       has_table_privilege('anon', 'public.lifecycle_event_deliveries', 'select');
```

### 4. Vercel production environment variables

| Variable | Value |
| --- | --- |
| `FORMBOOK_UPGRADE_URL` | The Scaling checkout page, without any `ref`. The app adds `?ref=<account reference>` and nothing else. Upgrade button hidden when unset. |
| `FORMBOOK_BILLING_PORTAL_URL` | The customer billing portal link. Linked as is. Hidden when unset. |
| `FORMBOOK_LIFECYCLE_WEBHOOK_URL` | The inbound webhook URL that receives lifecycle events. Nothing is sent while unset. |
| `FORMBOOK_LIFECYCLE_WEBHOOK_SECRET` | `openssl rand -hex 32`. Signs each lifecycle request (`X-FormBook-Signature`). |
| `FORMBOOK_DEMO_VIDEO_URL` | Walkthrough video link on the home page. Hidden when unset. |
| `FORMBOOK_SETUP_CALL_URL` | Existing. Free setup call booking link, now also on `/admin/funnels`, `/admin/plan` and the home page. |

The home page is rendered at build time, so changing `FORMBOOK_DEMO_VIDEO_URL`, `FORMBOOK_SETUP_CALL_URL` or `GOOGLE_OAUTH_CLIENT_ID` needs a redeploy before the home page shows it.

### 5. GoHighLevel setup (owner, in person)

The billing and account sync setup in GoHighLevel (custom fields, workflows, checkout page and billing portal) is described in the private release notes. Complete it before the deploy.

The lifecycle webhook request body is flat JSON with these keys: `schema` (`formbook.lifecycle.v1`), `event`, `event_id`, `occurred_at`, `sent_at`, `account_ref`, `contact_name`, `email`, `phone`, `business_name`, `website`, `plan`, `plan_name`, `previous_plan`, `previous_plan_name`, `frozen_forms_by_change`, `frozen_pixels_by_change`, `active_forms`, `draft_forms`, `frozen_forms`, `meta_pixels`, `connections`, `leads_total`, `bookings_total`, `signed_up_at`. Events: `signup_verified`, `first_connection_added`, `first_form_activated`, `first_lead`, `first_booking`, `plan_changed`, `account_suspended`, `account_restored`, `test_ping`. It never carries a tenant id, user id or token. Each request is signed with `X-FormBook-Signature`.

`/api/provision` with `account_ref` never creates a user or tenant: an unknown reference returns `404 {"error":"Account not found."}`. When both `account_ref` and `email` are sent, `account_ref` wins.

### 6. Deploy

Merge and push only after steps 3 to 5.

### 7. Smoke tests

- [ ] S1 Plan page as a free tenant: usage meters show; the Upgrade button opens the order page with only `?ref=fba_...` added to the URL.
- [ ] S2 Limits: with 3 active forms, activating a fourth shows the limit message with the "See plans and upgrade" link.
- [ ] S3 Checkout with a test payment on a test tenant: the account reference reaches `/api/provision`; the tenant becomes Scaling; the plan history shows a row by Billing automation.
- [ ] S4 Downgrade on the test tenant through `/api/provision` with plan `free`: the account moves to free and extra forms are frozen.
- [ ] S5 Upgrade the same tenant again: ready frozen forms are restored.
- [ ] S6 Lifecycle: with the webhook URL set, "Send test event" succeeds; first connection, form, lead and booking events each arrive once.
- [ ] S7 Onboarding: the checklist ticks through; templates work; the preview shows live colors and makes no `/api/*` requests; the setup-call card can be dismissed.
- [ ] S8 Home page: renders with JavaScript disabled; Lighthouse accessibility and SEO show no errors; `/opengraph-image` and `/twitter-image` render; `/robots.txt` and `/sitemap.xml` load.
- [ ] S9 Owner page: funnel counts match the client list; the plan history of the test tenant shows every change.

### 8. Rollback

A code rollback through Vercel is safe with `0032` to `0034` applied: all changes are additive, and older code ignores the new columns, tables and triggers (the older plan trigger body would count frozen forms as drafts again, which can only block draft creation). To pause lifecycle sends, unset `FORMBOOK_LIFECYCLE_WEBHOOK_URL`. To undo a wrong freeze, set the plan again from Client Management (restore runs) or clear `funnels.frozen_at` by hand.

## Sprint 3 release checklist

Sprint 3 splits what GoHighLevel did into two roles. Each form now books into one calendar (GoHighLevel, Google Calendar, Cal.com or Calendly) and sends its leads to one CRM (GoHighLevel, HubSpot or a signed webhook for n8n, Zapier, Make and others). Existing forms stay on GoHighLevel for both roles and keep working as before. The admin page `/admin/ghl-connections` becomes `/admin/connections` (the old address redirects). Follow the steps in order.

### 1. Back up production first

Supabase dashboard: Database, Backups, take a manual backup (or `pg_dump` the production database and keep the file somewhere safe).

### 2. Apply the migrations in order

If the Sprint 2 migrations (`0025` to `0028`) are not applied yet, apply them first with the Sprint 2 checklist below. Then run, in order:

- `0029_connections.sql` (generic connections, calendar and CRM choice per form, lead reference, booking attempt provider columns). Adding `lead_sessions.external_ref` rewrites that table once.
- `0030_calendar_booking_guard.sql` (one pending FormBook booking per calendar connection and start time; live hold lookup).
- `0031_crm_deliveries.sql` (the CRM delivery queue and log, one booking row per Calendly invitee).

Each file is additive and safe to run twice. After all three:

```sql
select calendar_provider, crm_provider, count(*) from public.funnels group by 1, 2;   -- existing rows: ghl / ghl
select count(*) from public.lead_sessions where external_ref is null;                 -- 0
select relname, relrowsecurity from pg_class
where oid in ('public.connections'::regclass, 'public.crm_event_deliveries'::regclass);   -- both true
select grantee, table_name, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('connections', 'crm_event_deliveries')
  and grantee in ('anon', 'authenticated');   -- no rows
select p.proname, r.rolname from pg_proc p cross join pg_roles r
where p.pronamespace = 'public'::regnamespace and r.rolname in ('anon', 'authenticated')
  and p.proname in ('claim_crm_deliveries', 'claim_crm_deliveries_by_ids', 'settle_crm_delivery', 'release_crm_delivery',
    'retry_crm_delivery', 'crm_housekeeping', 'enforce_connection_cap', 'enforce_funnel_generic_connections')
  and has_function_privilege(r.rolname, p.oid, 'execute');   -- no rows
select indexname from pg_indexes
where indexname in ('booking_attempts_connection_pending_slot_uidx', 'booking_attempts_connection_external_uidx',
                    'crm_event_deliveries_target_event_uidx');   -- 3 rows
```

### 3. Vercel production environment variables

- `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` from step 4. Until both are set, the Connect Google Calendar button is hidden.
- `FORMBOOK_EXTRA_APP_ORIGINS=https://formbooking.gondaltech.app` only if that optional extra address is attached, so Google sign-ins can start from either. Leave it empty otherwise.
- `FORMBOOK_SUPPORT_EMAIL`: the public contact address. It replaces the built-in address on the product, legal, plan and signup pages and in account messages, and is shown on `/help/connections` (the line there is hidden when empty). Redeploy after changing it.
- `NEXT_PUBLIC_APP_URL` must be the final https address before any customer connects Calendly: Calendly booking notifications are sent there. After a later address change, each Calendly connection needs `Set up confirmations` again.
- `CRON_SECRET` (from Sprint 2) also protects `/api/cron/crm-events`. `LEADDER_TOKEN_ENCRYPTION_KEY` stays unchanged: every new token and secret is encrypted with it.

### 4. Google Cloud (owner, in person)

1. Create a Google Cloud project for FormBook and enable the Google Calendar API.
2. OAuth consent screen: user type External; app name FormBook; support email and developer contact: the owner's FormBook support address; home page, privacy policy and terms links on `https://app.formbook.ca` (`/`, `/privacy`, `/terms`); authorised domain `formbook.ca`, plus `gondaltech.app` only if the optional extra address is used.
3. Scopes: `openid`, `email`, `https://www.googleapis.com/auth/calendar.freebusy`, `https://www.googleapis.com/auth/calendar.events.owned`. Write down the class Google shows for each scope (sensitive or restricted); FormBook assumes both calendar scopes are sensitive (unverified point U1).
4. Credentials: OAuth client, type Web application, with these authorised redirect URIs:
   - `https://app.formbook.ca/api/connect/google/callback`
   - `https://formbooking.gondaltech.app/api/connect/google/callback` (only if the optional extra address is used)
5. While the app is in Testing, add the Google accounts that may connect as test users. In Testing, only those accounts can connect and Google may expire their access after 7 days (U6), so customers cannot rely on it yet.
6. Submit for verification with this justification: "FormBook reads free and busy times to offer open meeting times on the customer's booking form and creates the booked meeting on the customer's own calendar." Attach a demo video showing: connecting Google Calendar, setting working hours, a booking on a form, and the event in Google Calendar. Verification can take weeks.

### 5. Calendly, Cal.com and HubSpot

Nothing to register: each customer pastes their own token. Calendly needs `NEXT_PUBLIC_APP_URL` set correctly (step 3).

### 6. Vercel crons

`vercel.json` schedules two 5-minute crons: `/api/cron/meta-events` and `/api/cron/crm-events`. Confirm the plan allows both (U22). If it allows only one, call the CRM drain from the Meta cron instead. After the deploy, the Cron Jobs tab shows both returning 200.

### 7. Deploy

Run the smoke tests below on the demo Gondal Tech account with test forms only, never on a customer's form. Record the result of every unverified point (U1 to U24 in the internal Sprint 3 notes) next to its step.

### 8. Smoke tests

GoHighLevel (nothing may change for existing forms):

- R1. An existing GoHighLevel form captures a lead (contact and opt-in opportunity as before), the answers sync, times load, and booking creates the appointment and moves the opportunity.
- R2. Connect GoHighLevel with one-click sign-in: it lands on Connections with the success message. Opening `/admin/ghl-connections` redirects to `/admin/connections`.
- R3. Add a GoHighLevel connection by hand with a private integration token and save it.
- R4. Deleting a GoHighLevel connection that an Active form uses is refused with the list of forms.

Google Calendar:

- G1. Connect Google Calendar: the consent screen asks for the two calendar permissions only (U1).
- G2. Save working hours on the connection.
- G3. The form's times equal the working hours minus a test busy event; set 60 days ahead and check the last days load (U2, U7).
- G4. Book with "Add a Google Meet link" on: the event is on the primary calendar with the lead as guest and a Meet link (U3).
- G5. Double click the booking button, and book the same time from two browsers: one booking and one "That time was just taken" message (U4).
- G6. Delete the connection: Google shows FormBook's access removed from the account (U5).

Cal.com:

- C1. Add a Cal.com API key.
- C2. The form editor lists the account's event types (U9).
- C3. The form shows Cal.com's open times (U11).
- C4. A booking appears in Cal.com with the lead as attendee (U8).
- C5. A lead with a phone number and no email books successfully (U10).

Calendly:

- K1. On a free Calendly account, connect with a token that has exactly the scopes listed on the help page; booking confirmations show "Set up" (U12, U16).
- K2. The last form step shows Calendly's page with the name and email filled in (U14, U24).
- K3. Book in Calendly: the lead shows Booked once, the booking row exists once, and the CRM receives one `lead.booked`; the lead was matched by its reference, not its email (U13, U15).
- K4. Cancel the booking in Calendly: the booking row shows Cancelled.

HubSpot:

- H1. Add a HubSpot private app token; the connection shows the portal (U17, U18, U21).
- H2. A lead creates a contact with a note holding the answers and tracking details (U20).
- H3. With deals on, a lead creates a deal at the new-lead stage and booking moves it to the booked stage (U19).
- H4. A lead with a phone number and no email creates or updates a contact.

Webhook:

- W1. Point a webhook at a request inspector or an n8n Webhook node and choose Send test: `test.ping` arrives and its `X-FormBook-Signature` verifies with the help page snippet.
- W2. A lead's `lead.captured`, `lead.qualified` and `lead.booked` arrive in that order (U23).
- W3. An endpoint that answers 500 shows retries in the delivery log.
- W4. Saving `http://` and a private address (for example `https://10.0.0.1/hook`) is refused.

Consistency across calendars:

- On the split test results page and a form's Performance card, leads and bookings from a Google Calendar form and a Calendly form count the same way as GoHighLevel ones.
- The Meta event log shows one booked call (`Schedule`) for each booking, including Calendly bookings confirmed by both the page and the notification.
- The lead's page shows the booking with its calendar and meeting link, and its CRM deliveries.

### 9. Rollback

Forms can be switched back to a GoHighLevel calendar in the form editor. The migrations are additive, so no database rollback is needed. To stop all CRM sending at once, switch off the HubSpot and webhook connections: queued events are skipped and stay in the delivery log.

## Sprint 2 release checklist

Sprint 2 adds split tests, split test results and ad spend, Meta pixels with server-side events (Conversions API), the Meta event log and match quality view, and a demo seed script. Follow the steps in order.

### 1. Back up production first

Supabase dashboard: Database, Backups, take a manual backup (or run `pg_dump` against the production connection string and keep the file somewhere safe).

### 2. Apply the new migrations in order

Each file is additive and safe to run twice. Run the verification query after each one.

- `0025_split_tests.sql`:

  ```sql
  select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
  where t.typname = 'analytics_event_type' and enumlabel = 'form_start';
  select column_name from information_schema.columns
  where table_schema = 'public' and column_name = 'split_test_id' and table_name in ('analytics_events', 'lead_sessions');
  select tgname from pg_trigger where tgrelid in ('public.split_tests'::regclass, 'public.split_test_members'::regclass) and not tgisinternal;
  ```

- `0026_ad_spend.sql`:

  ```sql
  select relrowsecurity from pg_class where oid = 'public.ad_spend_entries'::regclass;   -- true
  ```

- `0027_meta_pixels_and_events.sql`:

  ```sql
  select conname from pg_constraint where conname in ('funnels_meta_pixel_needs_consent', 'funnels_meta_consent_lengths');
  select tgname from pg_trigger where tgrelid = 'public.meta_pixels'::regclass and not tgisinternal;
  select count(*) from public.funnels where meta_pixel_id is not null;   -- 0 right after the migration
  ```

- `0028_meta_controls_and_demo_marks.sql`:

  ```sql
  select proname from pg_proc where proname in ('meta_release_held', 'meta_match_key_coverage');
  ```

- After all four, the API roles have nothing on the new objects:

  ```sql
  select table_name, grantee, privilege_type from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated')
    and table_name in ('split_tests', 'split_test_members', 'ad_spend_entries', 'meta_pixels', 'meta_event_deliveries');   -- no rows
  select p.proname, r.rolname from pg_proc p cross join pg_roles r
  where p.pronamespace = 'public'::regnamespace and r.rolname in ('anon', 'authenticated')
    and p.proname in ('enforce_split_test_member_rules', 'enforce_split_test_rules', 'enforce_ad_spend_scope', 'enforce_meta_pixel_limit',
      'enforce_funnel_pixel_tenant', 'meta_link_visitor_events', 'claim_meta_deliveries', 'claim_meta_deliveries_by_ids',
      'settle_meta_delivery', 'release_meta_delivery', 'meta_housekeeping', 'meta_release_held', 'meta_match_key_coverage')
    and has_function_privilege(r.rolname, p.oid, 'execute');   -- no rows
  select relname, relrowsecurity from pg_class
  where oid in ('public.split_tests'::regclass, 'public.split_test_members'::regclass, 'public.ad_spend_entries'::regclass,
                'public.meta_pixels'::regclass, 'public.meta_event_deliveries'::regclass);   -- all true
  ```

### 3. Vercel production environment variables

- Add `CRON_SECRET` (random, 32 or more characters). It protects `/api/cron/meta-events`; Vercel sends it as a Bearer token.
- Confirm `LEADDER_TOKEN_ENCRYPTION_KEY` is unchanged. Meta pixel tokens are encrypted with it, like GoHighLevel tokens.

### 4. Vercel plan

`vercel.json` schedules the cron every 5 minutes. Confirm the project's plan allows a 5-minute cron before deploying. After the deploy, the Cron Jobs tab shows `/api/cron/meta-events` returning 200.

### 5. Deploy

### 6. Smoke test: split tests

Create a test with two active forms of the demo account and start it. Open `/t/{slug}` in two browsers and in a private window and reload each twice (each visitor keeps the same form). Embed `/embed/t/{slug}` on a page of another domain and repeat in Chrome, Safari and Firefox. Check the counts on the results page. End the test with a winner and confirm the link now serves the winner.

### 7. Smoke test: Meta

Use the demo account's own pixel and a test event code from the Test events tab in Events Manager.

- Add the pixel. A second pixel on the Free plan is refused.
- "Send test event" succeeds and the event shows under Test events. If Meta refuses the token in the request body, change `lib/meta/send.ts` to send it in an `Authorization: Bearer` header and redeploy. If Meta refuses the API version, change `META_GRAPH_API_VERSION` in `lib/meta/constants.ts`.
- Attach the pixel to a form with the consent confirmation. Submit a lead, answer the questions and book. The event log shows form view, form start, lead, qualified lead and booked call as `Sent` within a minute, without waiting for the cron, each with match keys. Events Manager shows them under Test events.
- Read the Meta response of one sent row and one failed row (make one fail with a second pixel that has a wrong pixel ID).
- Turn on the consent checkbox. Submit a lead without ticking it: its view and start rows show `Cancelled` and nothing else is queued. Tick it on another lead: its rows are sent.
- Switch the pixel to "Hold for review". Submit a lead: its rows are `Held`. "Send held events to Meta" on the lead's page sends them, and a later booking for that lead is sent automatically.
- With the browser pixel bridge snippet and the Meta browser pixel on the embedding page, Events Manager shows the browser and server events as deduplicated.
- Remove the test event code when done.

### 8. Demo seed (optional)

```sh
node scripts/seed-demo.mjs --config <seed config json> --tenant <demo tenant id> --batch demo-2026-11-26 > demo.sql
```

The script only prints SQL; it never connects to a database. Read the SQL, set the demo tenant to the Scaling plan in `/admin/clients`, run the SQL in the Supabase SQL editor, and compare the final check query with the totals in the seed config. Forms and split tests it creates show a "Sample data" banner. To remove the batch, run the script with `--batch <name> --remove` and run the delete SQL it prints.

## Sprint 1 release checklist

### 1. Back up production first

- Supabase dashboard: Database, Backups, take a manual backup (or run `pg_dump` against the production connection string and keep the file somewhere safe).
- Explain the migration count before applying anything. Production reports 20 applied migrations while the repo had 19 files (`0001` to `0019`). Read the history and note which entry has no matching file:

```sql
select version, name from supabase_migrations.schema_migrations order by version;
```

- Do **not** re-apply old files. Only the five new files below are applied in this release.

### 2. Pause provisioning

Pause the GoHighLevel workflow that calls `/api/provision` until the deploy is done.

### 3. Apply the new migrations in order

Before anything else, run this read-only check. It lists forms linked to a GoHighLevel connection that belongs to a different tenant. `0021` stops with an error naming these forms rather than unlinking them, so fix each one by hand first (point it at a connection from its own tenant, or set `ghl_connection_id` to null on purpose) and note the old value:

```sql
select f.id as funnel_id, f.tenant_id as funnel_tenant, f.ghl_connection_id, c.tenant_id as connection_tenant
from public.funnels f
join public.ghl_connections c on c.id = f.ghl_connection_id
where c.tenant_id <> f.tenant_id;
```

Run each file in the Supabase SQL editor, in this order. Each one is safe to run twice. Run the verification query after each file before moving on.

1. `supabase/migrations/0020_plans_and_form_limits.sql`

```sql
-- Only free, scaling or suspended remain.
select plan, count(*) from public.tenants group by plan order by plan;
-- Plan table seeded.
select plan, display_name, monthly_price_cents, max_active_forms, max_draft_forms, max_pixels
from public.plan_limits order by plan;
-- Constraint exists once.
select conname from pg_constraint where conname = 'tenants_plan_check';
```

2. `supabase/migrations/0021_security_rate_limits_reports.sql`

```sql
-- Triggers on funnels (expect funnels_enforce_plan_limits, funnels_block_publish_when_taken_down,
-- funnels_enforce_connection_tenant).
select tgname from pg_trigger
where tgrelid = 'public.funnels'::regclass and not tgisinternal order by tgname;
-- Logo bucket no longer accepts SVG.
select id, allowed_mime_types from storage.buckets where id = 'funnel-assets';
```

3. `supabase/migrations/0022_self_serve_signup.sql`

```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'tenants'
  and column_name in ('contact_name', 'contact_email', 'contact_phone', 'business_name', 'website', 'signup_source');
```

**Hard gate before deploy.** The new code refuses the admin to any user whose email is not confirmed. Existing members were created by the owner and never received a verification email, so confirm them now. List them first:

```sql
select tm.user_id, u.email, t.signup_source
from public.tenant_members tm
join auth.users u on u.id = tm.user_id
join public.tenants t on t.id = tm.tenant_id
where u.email_confirmed_at is null;
```

If that returns rows, check each address belongs to the expected client, then confirm only members of existing (non self-serve) tenants:

```sql
update auth.users u
set email_confirmed_at = now()
where u.email_confirmed_at is null
  and u.id in (
    select tm.user_id from public.tenant_members tm
    join public.tenants t on t.id = tm.tenant_id
    where t.signup_source in ('legacy', 'provisioned')
  );
```

Re-run the list query and expect no rows before moving on. Anyone missed can still get in with "Forgot password" (the login page now says so).

4. `supabase/migrations/0023_owner_tools.sql`

```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'tenants'
  and column_name in ('badge_enabled', 'plan_before_suspension', 'suspended_at', 'suspension_reason');
select count(*) from public.owner_list_clients();
```

5. `supabase/migrations/0024_close_direct_writes.sql`

```sql
-- Expect every column false: the API roles can no longer write tenant tables.
select t as table_name,
  has_table_privilege('authenticated', 'public.' || t, 'UPDATE') as authenticated_update,
  has_table_privilege('authenticated', 'public.' || t, 'INSERT') as authenticated_insert,
  has_table_privilege('anon', 'public.' || t, 'UPDATE') as anon_update
from unnest(array['tenants', 'tenant_members', 'ghl_connections', 'funnels', 'questions', 'question_options',
  'lead_sessions', 'lead_status_history', 'lead_answers', 'booking_attempts', 'analytics_events']) as t;
-- Expect no rows: only select policies remain on the tenant tables.
select tablename, policyname, cmd from pg_policies
where schemaname = 'public' and cmd <> 'SELECT'
  and tablename in ('tenants', 'tenant_members', 'ghl_connections', 'funnels', 'questions', 'question_options',
    'lead_sessions', 'lead_status_history', 'lead_answers', 'booking_attempts', 'analytics_events');
-- Expect every column false: the API roles can no longer read any table either
-- (the app reads with the service role). This covers the GoHighLevel token columns.
select t as table_name,
  has_table_privilege('authenticated', 'public.' || t, 'SELECT') as authenticated_select,
  has_table_privilege('anon', 'public.' || t, 'SELECT') as anon_select
from unnest(array['tenants', 'tenant_members', 'ghl_connections', 'funnels', 'questions', 'question_options',
  'lead_sessions', 'lead_status_history', 'lead_answers', 'booking_attempts', 'analytics_events',
  'plan_limits', 'rate_limit_counters', 'form_reports', 'signup_requests', 'owner_audit_log']) as t;
-- Expect true for every connection that exists today (the Gondal Tech account),
-- so its attribution custom fields keep flowing. New connections default to false.
select id, name, location_id, use_gondal_attribution_fields from public.ghl_connections;
-- As the authenticated role, a plan change must fail with "permission denied".
begin;
set local role authenticated;
update public.tenants set plan = 'scaling' where false;
rollback;
```

After all five, check function grants and RLS:

```sql
-- Every new function: anon and authenticated false, service_role true.
select p.proname,
  has_function_privilege('anon', p.oid, 'execute') as anon_can,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can,
  has_function_privilege('service_role', p.oid, 'execute') as service_role_can
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('rate_limit_hit', 'rate_limit_hit_capped', 'rate_limit_release', 'get_auth_user_id_by_email', 'is_auth_user_confirmed',
                    'complete_signup', 'owner_list_clients')
order by p.proname;

-- Every new table has RLS on (relrowsecurity = true) and no policies.
select c.relname, c.relrowsecurity,
  (select count(*) from pg_policies pol where pol.schemaname = 'public' and pol.tablename = c.relname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('plan_limits', 'rate_limit_counters', 'form_reports', 'signup_requests', 'owner_audit_log')
order by c.relname;
```

### 4. Supabase Auth settings

- Authentication, Providers, Email: "Confirm email" **on**. If it is off, the fallback signup confirms the address immediately and skips verification.
- URL configuration: Site URL `https://app.formbook.ca`.
- Redirect allow list:
  - `https://app.formbook.ca/auth/confirm`
  - `https://formbooking.gondaltech.app/auth/confirm` (only if the optional extra address is used)
  - `http://localhost:3000/auth/confirm`

### 5. Vercel production environment variables

Set every variable in `.env.example`:

| Variable | Production value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | From the production Supabase project |
| `NEXT_PUBLIC_APP_URL` | `https://app.formbook.ca` |
| `LEADDER_TOKEN_ENCRYPTION_KEY` | Unchanged (changing it breaks stored GoHighLevel tokens) |
| `LEADDER_PROVISION_SECRET` | Unchanged |
| `GHL_OAUTH_CLIENT_ID`, `GHL_OAUTH_CLIENT_SECRET` | Unchanged |
| `FORMBOOK_OWNER_EMAILS` | The owner's address |
| `FORMBOOK_IP_HASH_SALT` | Random, 32+ characters (`openssl rand -base64 32`) |
| `FORMBOOK_GHL_SIGNUP_WEBHOOK_URL` | **Required.** Inbound webhook URL from step 6. Without it, `/signup` refuses new accounts in production (and on preview deployments) and logs an error: the Supabase fallback email only works in the same browser and its resend link does not work with `/auth/confirm`, so it is for local development only. |
| `FORMBOOK_GHL_PASSWORD_RESET_WEBHOOK_URL` | Inbound webhook URL from step 6 |
| `FORMBOOK_SETUP_CALL_URL` | The owner's booking link for the free setup call |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | **Required.** From Cloudflare Turnstile (add both hostnames to the widget). Without both, `/signup` refuses new accounts in production and logs an error. Preview deployments need them too (Cloudflare publishes test keys that always pass). |

Confirm `LEADDER_DEFAULT_TENANT_ID` and `LEADDER_DEMO_SLOT_MODE` are **not** set in production. `LEADDER_DEFAULT_TENANT_ID` also turns on the local owner bypass outside production.

### 6. GoHighLevel workflows (Gondal Tech account)

**FormBook signup verification**

- Trigger: Inbound Webhook. Copy its URL into `FORMBOOK_GHL_SIGNUP_WEBHOOK_URL`.
- Payload keys: `email`, `name`, `phone`, `business_name`, `website`, `verify_link`, `plan`.
- Map `email`, `name`, `phone`, `business_name`, `website` and `plan` to the contact.
- Add tag `formbook-signup`.
- Send an email from the owner's address with a button linking to `{{inboundWebhookRequest.verify_link}}`.
  - Subject: `Verify your FormBook account`
  - Body: `Hi {{name}}, click the button below to verify your email and choose your FormBook password. The link works once.`

**FormBook password reset**

- Trigger: Inbound Webhook. Copy its URL into `FORMBOOK_GHL_PASSWORD_RESET_WEBHOOK_URL`.
- Payload keys: `email`, `name`, `reset_link`.
- Send an email with a button linking to `{{inboundWebhookRequest.reset_link}}`.
  - Subject: `Reset your FormBook password`

Send one sample payload to each trigger and map the fields before going live.

### 7. Domains

- `app.formbook.ca` is the main address and stays attached in Vercel.
- Optional extra address: add `formbooking.gondaltech.app` to the project and, in DNS for `gondaltech.app`, a CNAME `formbooking` to the target Vercel shows (DNS only, not proxied).
- Do **not** redirect `app.formbook.ca/embed/*`. Existing embed snippets check `event.origin` against the address they were copied from. Keep every address that live embeds use serving the same app.
- GoHighLevel marketplace app: keep redirect URI `https://app.formbook.ca/api/connect/callback`. Add `https://formbooking.gondaltech.app/api/connect/callback` only if the optional extra address is used.

### 8. Deploy

Deploy only after steps 3 to 7 are done. Then re-enable the provisioning workflow and make sure it sends plan values `free` or `scaling` (old `tier1`, `tier2`, `tier3` values still work and become `scaling`).

### 9. Production smoke test

Use a fresh email address:

1. Sign up at `/signup`; the verification email arrives from GoHighLevel.
2. Open the link; you see the "Confirm my email" page (`/auth/verify`, which does not use the link until the button is pressed, so mail scanners cannot spend it). Press the button; you land on `/auth/set-password`. Choose a password and you reach `/admin/welcome`. This also confirms that `generateLink({ type: "magiclink" })` for an unconfirmed user produced a working verification link and set `email_confirmed_at`.
3. Create a form and activate it.
4. From another browser, open the form and use "Report this form".
5. As the owner, see the report in `/admin/clients`, take the form down, then restore it.
6. Request a password reset; the email arrives from GoHighLevel and the link works.
7. Confirm the "Powered by FormBook" badge shows on the free form, and is gone after turning the badge off in `/admin/clients`.
8. Confirm a signed-in non-owner gets a 404 on `/admin/clients`.
9. Connect a **second** GoHighLevel location (not the Gondal Tech account) from the new account with the one-click sign-in, link it to a form with a calendar, activate the form and submit a test lead. The lead must reach that location and the booking must work. Its connection has `use_gondal_attribution_fields = false`, so no Gondal Tech custom-field IDs are sent.
10. Try to activate a form with no GoHighLevel connection; it must refuse with a message about connecting GoHighLevel first.

### 10. Legal pages

`/terms`, `/privacy` and `/dpa` show a "Draft for review" banner. Set `LEGAL_REVIEW_PENDING` to `false` in `lib/legal.ts` only after the owner has reviewed all three pages and filled in the governing law and transfer mechanism placeholders.

## Fresh project setup

For a brand-new Supabase project (not production), run every file in `supabase/migrations` in filename order, then create the first tenant and owner:

```sql
insert into tenant_members (tenant_id, user_id, role)
values ('<tenant_id>', '<auth_user_id>', 'owner');
```

Confirm the `funnel-assets` bucket exists.

## Token encryption

GoHighLevel tokens are stored encrypted with `LEADDER_TOKEN_ENCRYPTION_KEY`. Generate a key with:

```bash
openssl rand -base64 32
```

For a project that still had plaintext GoHighLevel tokens:

1. Set `LEADDER_TOKEN_ENCRYPTION_KEY`.
2. Deploy the code.
3. Apply `0005_security_hardening.sql`.
4. Re-enter every GoHighLevel token in `/admin/connections`.
5. Verify stored token values begin with `v1:`.

## Row level security

The app talks to Postgres only through the service-role client. Tenant tables have RLS on; tables added since Sprint 1 (`plan_limits`, `rate_limit_counters`, `form_reports`, `signup_requests`, `owner_audit_log`) have RLS on and no policies, so the `anon` and `authenticated` roles see nothing. Since `0024` the API roles also have no table privileges at all (no select, insert, update or delete) on any FormBook table, so a signed-in user cannot read GoHighLevel token columns or owner notes through the REST API. New SQL functions are executable only by `service_role`. Verify with the queries in step 3 and with two test tenants.

## GoHighLevel setup

Customers connect GoHighLevel from `/admin/connections`, either with the one-click marketplace app (OAuth) or with a Private Integration Token.

For a Private Integration Token:

1. Create the token in the GoHighLevel sub-account.
2. Ensure token scopes include:
   - `contacts.write`
   - `opportunities.readonly`
   - `opportunities.write`
   - `calendars.readonly`
   - `calendars/events.write`
3. Record the location ID, calendar ID, opt-in pipeline and stage IDs, and booked-call pipeline and stage IDs.
4. Add the connection in `/admin/connections`.
5. Configure each form with its own connection, calendar, pipeline stages and appointment title. A form can only use a connection from its own account.
6. Run the live validation plan in `docs/ghl-live-test-plan.md`.

## Ongoing checklist

- `npm run typecheck`, `npm test`, `npm run lint` and `npm run build` pass.
- Supabase migrations applied in order; no old file re-applied.
- Vercel env vars match the production Supabase project.
- `LEADDER_DEFAULT_TENANT_ID` and `LEADDER_DEMO_SLOT_MODE` are not set in production.
- Public `/book/[slug]` and `/embed/[slug]` tested on narrow phones, iframe and popup.
- Production logs and error monitoring are configured.
