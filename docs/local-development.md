# Local Development Setup

This guide gets Leadder Scheduler fully visible with real Supabase data and safe demo slots. It does not require real GoHighLevel credentials.

## What You Will Have

- Admin dashboard: `http://localhost:3000/admin/funnels`
- GHL connection admin: `http://localhost:3000/admin/ghl-connections`
- Public demo funnel: `http://localhost:3000/book/demo-consultation`
- Iframe demo funnel: `http://localhost:3000/embed/demo-consultation`
- Demo tenant ID: `00000000-0000-0000-0000-000000000001`
- Demo funnel slug: `demo-consultation`

## Required Environment Variables

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
SUPABASE_SERVICE_ROLE_KEY=
LEADDER_DEFAULT_TENANT_ID=00000000-0000-0000-0000-000000000001
LEADDER_TOKEN_ENCRYPTION_KEY=
LEADDER_DEMO_SLOT_MODE=true
```

`LEADDER_DEFAULT_TENANT_ID` bypasses admin login locally only. Do not set it in production.

`LEADDER_DEMO_SLOT_MODE=true` enables server-side demo slots locally only. It is ignored when `NODE_ENV=production`.

Generate the encryption key:

```bash
openssl rand -base64 32
```

## Create Or Connect Supabase

### Option A: Hosted Supabase Project

1. Create a project at Supabase.
2. Open Project Settings, then API.
3. Copy:
   - Project URL to `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key to `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key to `SUPABASE_SERVICE_ROLE_KEY`
4. Open the SQL Editor.
5. Run the migration files in this order:
   - `supabase/migrations/0001_leadder_scheduler.sql`
   - `supabase/migrations/0002_seed_demo_funnel.sql`
   - `supabase/migrations/0003_storage.sql`
   - `supabase/migrations/0004_scheduler_hardening.sql`
   - `supabase/migrations/0005_security_hardening.sql`

### Option B: Supabase CLI

1. Log in and link the project:

```bash
supabase login
supabase link --project-ref <project-ref>
```

2. Push migrations:

```bash
supabase db push
```

## Configure `.env.local`

Create the file:

```bash
cp .env.example .env.local
```

Fill it in:

```text
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
NEXT_PUBLIC_APP_URL=http://localhost:3000
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
LEADDER_DEFAULT_TENANT_ID=00000000-0000-0000-0000-000000000001
LEADDER_TOKEN_ENCRYPTION_KEY=<openssl-rand-base64-32-output>
LEADDER_DEMO_SLOT_MODE=true
```

Restart the dev server after changing `.env.local`.

## Admin User Setup

For local visual QA, no Supabase Auth user is required when this is set:

```text
LEADDER_DEFAULT_TENANT_ID=00000000-0000-0000-0000-000000000001
```

That setting lets the admin UI act as the demo tenant owner in non-production only.

For a production-like auth test:

1. Create a user in Supabase Auth.
2. Copy the auth user ID.
3. Insert a tenant membership:

```sql
insert into tenant_members (tenant_id, user_id, role)
values (
  '00000000-0000-0000-0000-000000000001',
  '<auth_user_id>',
  'owner'
)
on conflict (tenant_id, user_id) do update
set role = excluded.role;
```

4. Remove `LEADDER_DEFAULT_TENANT_ID` from `.env.local`.
5. Restart `npm run dev`.
6. Sign in at `http://localhost:3000/login`.

## Seeded Demo Data

The demo seed creates:

- Tenant: `Demo Growth Agency`
- GHL connection: `Demo GHL Connection`
- Funnel: `Growth Strategy Consultation`
- Slug: `demo-consultation`
- Appointment title: `Growth Strategy Call`
- Theme:
  - `primary_color`: `#111827`
  - `accent_color`: `#0f766e`
  - `button_color`: `#111827`
  - `border_radius`: `10`
- Questions:
  - Current monthly revenue
  - Growth goal
  - Timeline
  - Website

The demo GHL connection uses fake IDs and no token. It is only usable with `LEADDER_DEMO_SLOT_MODE=true`.

## Start The App

```bash
npm install
npm run dev
```

Open:

- Homepage: `http://localhost:3000`
- Admin: `http://localhost:3000/admin/funnels`
- GHL connections: `http://localhost:3000/admin/ghl-connections`
- Public funnel: `http://localhost:3000/book/demo-consultation`
- Embed funnel: `http://localhost:3000/embed/demo-consultation`

## Demo Slot Mode

When `LEADDER_DEMO_SLOT_MODE=true` and `NODE_ENV` is not `production`:

- Lead capture still writes real `lead_sessions`.
- Answers still write real `lead_answers`.
- Analytics still writes real `analytics_events`.
- Booking attempts still write real `booking_attempts`.
- GHL contact, opportunity, availability, and appointment calls are skipped.
- Server-side demo IDs are stored with a `demo_` prefix.
- Server-side sample slots are generated for visual QA.

When `NODE_ENV=production`, demo slots are disabled even if the env var is accidentally set.

## Common Setup Problems

- Setup screen on `/book/demo-consultation`: `.env.local` is missing or the Supabase env vars are blank.
- Admin redirects to `/login`: remove production mode, or set `LEADDER_DEFAULT_TENANT_ID` for local visual QA.
- Admin loads but no funnel appears: rerun `0002_seed_demo_funnel.sql`.
- Slot lookup fails: confirm `LEADDER_DEMO_SLOT_MODE=true` for local visual QA.
- GHL token error: you are not in demo slot mode, and the demo GHL connection has no real encrypted token.
