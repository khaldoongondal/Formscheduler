# Production Deployment Package

## Supabase Setup

1. Create a Supabase project.
2. Enable Supabase Auth email/password or the chosen production identity provider.
3. Apply migrations in order:
   - `0001_leadder_scheduler.sql`
   - `0002_seed_demo_funnel.sql`
   - `0003_storage.sql`
   - `0004_scheduler_hardening.sql`
   - `0005_security_hardening.sql`
4. Create the production tenant.
5. Create the first admin user in Supabase Auth.
6. Insert the first owner membership:

```sql
insert into tenant_members (tenant_id, user_id, role)
values ('<tenant_id>', '<auth_user_id>', 'owner');
```

7. Confirm RLS is enabled for all tenant-owned tables.
8. Confirm the `funnel-assets` bucket exists.

## GitHub Setup

1. Push the repository to GitHub.
2. Protect the production branch.
3. Require `npm run typecheck`, `npm run lint`, and `npm run build` in CI.
4. Store no production secrets in the repository.

## Vercel Setup

1. Import the GitHub repository into Vercel.
2. Set the framework preset to Next.js.
3. Use `npm run build` as the build command.
4. Configure production environment variables.
5. Set `NEXT_PUBLIC_APP_URL` to the canonical production URL.
6. Deploy after Supabase migrations have been applied.

## GHL Setup

1. Create a Private Integration Token for each connected GHL sub-account.
2. Ensure token scopes include:
   - `contacts.write`
   - `opportunities.readonly`
   - `opportunities.write`
   - `calendars.readonly`
   - `calendars/events.write`
3. Record the location ID.
4. Record the calendar ID.
5. Record opt-in pipeline and stage IDs.
6. Record booked-call pipeline and stage IDs.
7. Add the GHL connection in `/admin/ghl-connections`.
8. Configure each funnel with its own connection, calendar, pipeline stages, and appointment title.
9. Run the live validation plan in `docs/ghl-live-test-plan.md`.

## Environment Variables

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_APP_URL=
SUPABASE_SERVICE_ROLE_KEY=
LEADDER_TOKEN_ENCRYPTION_KEY=
```

Local development only:

```text
LEADDER_DEFAULT_TENANT_ID=
LEADDER_DEMO_SLOT_MODE=
```

Generate `LEADDER_TOKEN_ENCRYPTION_KEY`:

```bash
openssl rand -base64 32
```

## Migration Order

For a fresh project, run every migration in `supabase/migrations` in filename order.

For an existing project that had plaintext GHL tokens:

1. Set `LEADDER_TOKEN_ENCRYPTION_KEY`.
2. Deploy the code.
3. Apply `0005_security_hardening.sql`.
4. Re-enter every GHL token in `/admin/ghl-connections`.
5. Verify stored token values begin with `v1:`.

## Production Checklist

- Typecheck passes.
- Lint passes.
- Build passes.
- Supabase migrations applied.
- First owner membership inserted.
- RLS policies verified with two test tenants.
- GHL tokens rotated into encrypted storage.
- GHL live test plan completed.
- Public `/book/[slug]` tested on 320px, iPhone, Android, iframe, and popup widths.
- Vercel env vars match production Supabase project.
- `LEADDER_DEFAULT_TENANT_ID` is not set in production.
- `LEADDER_DEMO_SLOT_MODE` is not set in production.
- Production logs and error monitoring are configured.
