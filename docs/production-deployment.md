# FormBook production deployment

FormBook is a tool from Gondal Tech. Production address after the move: `https://formbooking.gondaltech.app` (old address `https://app.formbook.ca` keeps serving during the switch).

Pushing `main` deploys production on Vercel. Production has no staging copy, so follow the checklist below in order and do not skip the backup.

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
- URL configuration: Site URL `https://formbooking.gondaltech.app`.
- Redirect allow list:
  - `https://formbooking.gondaltech.app/auth/confirm`
  - `https://app.formbook.ca/auth/confirm` (during the switch)
  - `http://localhost:3000/auth/confirm`

### 5. Vercel production environment variables

Set every variable in `.env.example`:

| Variable | Production value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | From the production Supabase project |
| `NEXT_PUBLIC_APP_URL` | `https://formbooking.gondaltech.app` |
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

### 7. Domain move

- Vercel: add `formbooking.gondaltech.app` to the project. Keep `app.formbook.ca` attached.
- DNS for `gondaltech.app`: CNAME `formbooking` to the target Vercel shows (DNS only, not proxied).
- Do **not** redirect `app.formbook.ca/embed/*`. Existing embed snippets check `event.origin` against the old address. Keep the old domain serving the same app until every live embed has been re-copied from the admin.
- GoHighLevel marketplace app: add redirect URI `https://formbooking.gondaltech.app/api/connect/callback`. Keep the old one until the switch is done.

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
4. Re-enter every GoHighLevel token in `/admin/ghl-connections`.
5. Verify stored token values begin with `v1:`.

## Row level security

The app talks to Postgres only through the service-role client. Tenant tables have RLS on; tables added since Sprint 1 (`plan_limits`, `rate_limit_counters`, `form_reports`, `signup_requests`, `owner_audit_log`) have RLS on and no policies, so the `anon` and `authenticated` roles see nothing. Since `0024` the API roles also have no table privileges at all (no select, insert, update or delete) on any FormBook table, so a signed-in user cannot read GoHighLevel token columns or owner notes through the REST API. New SQL functions are executable only by `service_role`. Verify with the queries in step 3 and with two test tenants.

## GoHighLevel setup

Customers connect GoHighLevel from `/admin/ghl-connections`, either with the one-click marketplace app (OAuth) or with a Private Integration Token.

For a Private Integration Token:

1. Create the token in the GoHighLevel sub-account.
2. Ensure token scopes include:
   - `contacts.write`
   - `opportunities.readonly`
   - `opportunities.write`
   - `calendars.readonly`
   - `calendars/events.write`
3. Record the location ID, calendar ID, opt-in pipeline and stage IDs, and booked-call pipeline and stage IDs.
4. Add the connection in `/admin/ghl-connections`.
5. Configure each form with its own connection, calendar, pipeline stages and appointment title. A form can only use a connection from its own account.
6. Run the live validation plan in `docs/ghl-live-test-plan.md`.

## Ongoing checklist

- `npm run typecheck`, `npm test`, `npm run lint` and `npm run build` pass.
- Supabase migrations applied in order; no old file re-applied.
- Vercel env vars match the production Supabase project.
- `LEADDER_DEFAULT_TENANT_ID` and `LEADDER_DEMO_SLOT_MODE` are not set in production.
- Public `/book/[slug]` and `/embed/[slug]` tested on narrow phones, iframe and popup.
- Production logs and error monitoring are configured.
