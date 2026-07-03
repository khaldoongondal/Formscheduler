# Security Hardening

## Token Encryption

GHL Private Integration Tokens are encrypted before storage in `ghl_connections.private_token_ciphertext`.

Runtime requirements:

- `LEADDER_TOKEN_ENCRYPTION_KEY` must be a base64-encoded 32-byte key.
- Generate one with:

```bash
openssl rand -base64 32
```

Storage behavior:

- New and updated GHL tokens are encrypted with AES-256-GCM.
- The stored value uses a versioned envelope: `v1:<iv>:<tag>:<ciphertext>`.
- Decryption only happens server-side in `lib/ghl/connections.ts` when building a GHL runtime config.
- Legacy plaintext values are rejected. Rotate each existing GHL token through `/admin/ghl-connections` after setting `LEADDER_TOKEN_ENCRYPTION_KEY`.

Migration steps:

1. Deploy code with `LEADDER_TOKEN_ENCRYPTION_KEY` configured.
2. Run migrations through `0005_security_hardening.sql`.
3. Re-enter every GHL Private Integration Token in the admin UI.
4. Confirm `private_token_ciphertext` values begin with `v1:`.
5. Remove any old plaintext token values from database backups according to the retention policy.

## RLS Rules

`0005_security_hardening.sql` enables RLS on:

- `tenants`
- `tenant_members`
- `ghl_connections`
- `funnels`
- `questions`
- `question_options`
- `lead_sessions`
- `lead_status_history`
- `lead_answers`
- `booking_attempts`
- `analytics_events`

Policy model:

- Authenticated users can select rows only for tenants listed in `tenant_members`.
- `owner` and `admin` can mutate tenant configuration and activity rows.
- `member` is read-only.
- Only `owner` can manage `tenant_members`.
- Public booking traffic continues through server API routes using the server-side service role.

Helper functions:

- `public.current_user_tenant_ids()`
- `public.has_tenant_role(target_tenant_id uuid, allowed_roles text[])`

## Server Role Enforcement

Application role model:

- `owner`: full tenant access, including member management by RLS policy.
- `admin`: can create, update, duplicate, publish, and delete funnels and GHL connections.
- `member`: can view admin pages and analytics, but cannot mutate tenant configuration.

Server actions and admin API writes call `requireTenantRole(["owner", "admin"])`.

Production setup must insert at least one owner:

```sql
insert into tenant_members (tenant_id, user_id, role)
values ('<tenant_id>', '<supabase_auth_user_id>', 'owner');
```
