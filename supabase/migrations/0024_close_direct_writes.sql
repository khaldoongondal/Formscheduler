-- FormBook Sprint 1 review fixes. Additive and safe to run twice.
--
-- 1. Close the direct-write path through the Supabase REST API. Every write in
--    the app goes through the service role, but 0005 let any tenant owner or
--    admin update tenants, funnels and other tenant tables with their own
--    login. With public signup that would let anyone change their own plan,
--    badge, suspension, form takedown or slug. Reads are closed in section 4.
-- 2. A guard trigger on tenants and funnels that refuses changes to the
--    platform-controlled columns from the anon and authenticated roles, even
--    if a write grant comes back by mistake later.
-- 3. rate_limit_hit_capped(): a counter that only counts allowed hits, so
--    refused requests do not use up a shared daily cap. rate_limit_release()
--    gives a hit back after a failed email send.
-- 4. Revoke table select from the API roles (the app reads with the service role).
-- 5. ghl_connections.use_gondal_attribution_fields, true for existing rows only.

-- 1. Drop the write policies from 0005. Select policies are kept.
drop policy if exists tenants_update_owner_admin on public.tenants;
drop policy if exists tenant_members_insert_owner on public.tenant_members;
drop policy if exists tenant_members_update_owner on public.tenant_members;
drop policy if exists tenant_members_delete_owner on public.tenant_members;
drop policy if exists ghl_connections_insert_owner_admin on public.ghl_connections;
drop policy if exists ghl_connections_update_owner_admin on public.ghl_connections;
drop policy if exists ghl_connections_delete_owner_admin on public.ghl_connections;
drop policy if exists funnels_insert_owner_admin on public.funnels;
drop policy if exists funnels_update_owner_admin on public.funnels;
drop policy if exists funnels_delete_owner_admin on public.funnels;
drop policy if exists questions_insert_owner_admin on public.questions;
drop policy if exists questions_update_owner_admin on public.questions;
drop policy if exists questions_delete_owner_admin on public.questions;
drop policy if exists question_options_insert_owner_admin on public.question_options;
drop policy if exists question_options_update_owner_admin on public.question_options;
drop policy if exists question_options_delete_owner_admin on public.question_options;
drop policy if exists lead_sessions_write_owner_admin on public.lead_sessions;
drop policy if exists lead_status_history_write_owner_admin on public.lead_status_history;
drop policy if exists lead_answers_write_owner_admin on public.lead_answers;
drop policy if exists booking_attempts_write_owner_admin on public.booking_attempts;
drop policy if exists analytics_events_write_owner_admin on public.analytics_events;

-- And revoke the table write grants from the API roles.
do $$
declare
  t text;
begin
  foreach t in array array[
    'tenants', 'tenant_members', 'ghl_connections', 'funnels', 'questions', 'question_options',
    'lead_sessions', 'lead_status_history', 'lead_answers', 'booking_attempts', 'analytics_events',
    'plan_limits', 'rate_limit_counters', 'form_reports', 'signup_requests', 'owner_audit_log'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke insert, update, delete, truncate on table public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;

-- 2. Guard triggers. Security invoker on purpose: current_user is the API role
-- (anon or authenticated) for REST calls, and service_role or postgres for the
-- app and migrations, which may change these columns.
create or replace function public.guard_tenant_platform_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') and (
    new.plan is distinct from old.plan or
    new.slug is distinct from old.slug or
    new.badge_enabled is distinct from old.badge_enabled or
    new.plan_before_suspension is distinct from old.plan_before_suspension or
    new.suspended_at is distinct from old.suspended_at or
    new.suspension_reason is distinct from old.suspension_reason or
    new.signup_source is distinct from old.signup_source
  ) then
    raise exception 'FORMBOOK_FORBIDDEN:tenant_platform_columns' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists tenants_guard_platform_columns on public.tenants;
create trigger tenants_guard_platform_columns
before update on public.tenants
for each row execute function public.guard_tenant_platform_columns();

create or replace function public.guard_funnel_platform_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') and (
    new.tenant_id is distinct from old.tenant_id or
    new.slug is distinct from old.slug or
    new.taken_down_at is distinct from old.taken_down_at or
    new.taken_down_reason is distinct from old.taken_down_reason
  ) then
    raise exception 'FORMBOOK_FORBIDDEN:funnel_platform_columns' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists funnels_guard_platform_columns on public.funnels;
create trigger funnels_guard_platform_columns
before update on public.funnels
for each row execute function public.guard_funnel_platform_columns();

-- 3. Counter that adds a hit only while under the limit. Returns true when
-- the hit was allowed (and counted), false when the limit was already reached.
create or replace function public.rate_limit_hit_capped(p_bucket_key text, p_window_seconds integer, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits integer;
begin
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 172800 then
    raise exception 'rate_limit_hit_capped: invalid window' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 0 then
    raise exception 'rate_limit_hit_capped: invalid limit' using errcode = '22023';
  end if;
  if p_limit = 0 then
    return false;
  end if;

  insert into public.rate_limit_counters as c (bucket_key, hits, expires_at)
  values (p_bucket_key, 1, now() + make_interval(secs => p_window_seconds))
  on conflict (bucket_key) do update set hits = c.hits + 1
    where c.hits < p_limit
  returning c.hits into v_hits;

  -- No row returned: the counter was already at the limit and was not changed.
  return v_hits is not null;
end;
$$;
revoke all on function public.rate_limit_hit_capped(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit_capped(text, integer, integer) to service_role;

-- Gives back one hit, used when an email send fails after taking a cooldown
-- slot, so a failed send does not block the retry.
create or replace function public.rate_limit_release(p_bucket_key text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.rate_limit_counters
  set hits = hits - 1
  where bucket_key = p_bucket_key and hits > 0;
$$;
revoke all on function public.rate_limit_release(text) from public, anon, authenticated;
grant execute on function public.rate_limit_release(text) to service_role;

-- 4. Close the read path too. The app reads every table with the service role;
-- the user-scoped client is only used for Supabase Auth calls. The select
-- policies from 0005 let any signed-in member read, through the REST API,
-- the GoHighLevel token ciphertext columns and the owner-only suspension and
-- takedown notes. With public signup anyone can get such a session, so the
-- API roles lose every table privilege here. If a user-scoped read is ever
-- needed, grant column-level select that leaves out the *_ciphertext columns
-- and the owner-only tenant and funnel fields.
do $$
declare
  t text;
begin
  foreach t in array array[
    'tenants', 'tenant_members', 'ghl_connections', 'funnels', 'questions', 'question_options',
    'lead_sessions', 'lead_status_history', 'lead_answers', 'booking_attempts', 'analytics_events',
    'plan_limits', 'rate_limit_counters', 'form_reports', 'signup_requests', 'owner_audit_log'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke select on table public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;

-- 5. GoHighLevel attribution custom fields. The field IDs in lib/ghl/attribution.ts
-- exist only in the Gondal Tech GoHighLevel account. They are sent only for
-- connections flagged here, so other accounts never receive foreign field IDs.
-- Every connection that exists before self-serve signup is the Gondal Tech one,
-- so existing rows are flagged once; new connections default to false.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ghl_connections' and column_name = 'use_gondal_attribution_fields'
  ) then
    alter table public.ghl_connections
      add column use_gondal_attribution_fields boolean not null default false;
    update public.ghl_connections set use_gondal_attribution_fields = true;
  end if;
end $$;

notify pgrst, 'reload schema';
