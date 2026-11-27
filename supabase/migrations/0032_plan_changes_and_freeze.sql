-- FormBook Sprint 4 P1: account reference, plan history, downgrade freeze and restore.
-- Additive and safe to run twice. Every existing row stays valid: no form or pixel is frozen by this file.

-- 1. Opaque account reference. The volatile default gives every row its own value.
alter table public.tenants
  add column if not exists account_ref text not null
  default ('fba_' || substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 24));
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenants_account_ref_format') then
    alter table public.tenants add constraint tenants_account_ref_format
      check (account_ref ~ '^fba_[0-9a-f]{24}$');
  end if;
end $$;
create unique index if not exists tenants_account_ref_uidx on public.tenants (account_ref);

-- 2. Frozen forms and pixels, split test end reason.
alter table public.funnels add column if not exists frozen_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'funnels_frozen_not_published') then
    alter table public.funnels add constraint funnels_frozen_not_published
      check (frozen_at is null or is_published = false);
  end if;
end $$;
create index if not exists funnels_tenant_frozen_idx on public.funnels (tenant_id) where frozen_at is not null;

alter table public.meta_pixels add column if not exists frozen_at timestamptz;

alter table public.split_tests add column if not exists end_reason text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'split_tests_end_reason_check') then
    alter table public.split_tests add constraint split_tests_end_reason_check
      check (end_reason is null or (end_reason in ('form_frozen') and status = 'ended'));
  end if;
end $$;

-- Ranking reads.
create index if not exists lead_sessions_funnel_created_idx on public.lead_sessions (funnel_id, created_at desc);

-- 3. Plan history. Owner reads only.
create table if not exists public.tenant_plan_changes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  from_plan text check (from_plan is null or from_plan in ('free', 'scaling', 'suspended')),
  to_plan text not null check (to_plan in ('free', 'scaling', 'suspended')),
  source text not null check (source in ('provision', 'owner')),
  actor text check (actor is null or char_length(actor) <= 254),
  note text check (note is null or char_length(note) <= 500),
  frozen_forms integer not null default 0 check (frozen_forms >= 0),
  frozen_pixels integer not null default 0 check (frozen_pixels >= 0),
  restored_forms integer not null default 0 check (restored_forms >= 0),
  restored_pixels integer not null default 0 check (restored_pixels >= 0),
  ended_split_tests integer not null default 0 check (ended_split_tests >= 0),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object' and pg_column_size(details) <= 16384),
  created_at timestamptz not null default now()
);
create index if not exists tenant_plan_changes_tenant_idx on public.tenant_plan_changes (tenant_id, created_at desc);
create index if not exists tenant_plan_changes_to_scaling_idx on public.tenant_plan_changes (tenant_id) where to_plan = 'scaling';
alter table public.tenant_plan_changes enable row level security;

-- 4. Plan limits: frozen forms are not drafts. Same body as 0020 except the draft count.
create or replace function public.enforce_funnel_plan_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_limits public.plan_limits%rowtype;
  v_count integer;
begin
  if tg_op = 'UPDATE' then
    if new.tenant_id = old.tenant_id and new.is_published is not distinct from old.is_published then
      return new;
    end if;
    -- Active to Draft (or to Frozen) is always allowed.
    if new.tenant_id = old.tenant_id and old.is_published and not new.is_published then
      return new;
    end if;
  end if;

  select t.plan into v_plan from public.tenants t where t.id = new.tenant_id for update;
  if v_plan is null then
    raise exception 'FORMBOOK_LIMIT:tenant_missing' using errcode = 'P0001';
  end if;
  if v_plan = 'suspended' then
    raise exception 'FORMBOOK_LIMIT:suspended' using errcode = 'P0001';
  end if;

  select * into v_limits from public.plan_limits pl where pl.plan = v_plan;
  if not found then
    raise exception 'FORMBOOK_LIMIT:unknown_plan' using errcode = 'P0001';
  end if;

  if new.is_published then
    select count(*) into v_count from public.funnels f
    where f.tenant_id = new.tenant_id and f.is_published and f.id <> new.id;
    if v_count >= v_limits.max_active_forms then
      raise exception 'FORMBOOK_LIMIT:active_forms' using errcode = 'P0001';
    end if;
  else
    select count(*) into v_count from public.funnels f
    where f.tenant_id = new.tenant_id and not f.is_published and f.frozen_at is null and f.id <> new.id;
    if v_count >= v_limits.max_draft_forms then
      raise exception 'FORMBOOK_LIMIT:draft_forms' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

-- Activating a form clears its frozen mark.
create or replace function public.clear_funnel_frozen_on_activate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_published and not coalesce(old.is_published, false) then
    new.frozen_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists funnels_clear_frozen_on_activate on public.funnels;
create trigger funnels_clear_frozen_on_activate
before update of is_published on public.funnels
for each row execute function public.clear_funnel_frozen_on_activate();

-- 5. Pixel limit counts unfrozen pixels and guards unfreezing.
create or replace function public.enforce_meta_pixel_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_max integer;
  v_count integer;
begin
  if tg_op = 'UPDATE' and new.tenant_id = old.tenant_id
     and not (old.frozen_at is not null and new.frozen_at is null) then
    return new;
  end if;
  if new.frozen_at is not null then
    return new;
  end if;
  select t.plan into v_plan from public.tenants t where t.id = new.tenant_id for update;
  if v_plan is null then
    raise exception 'FORMBOOK_LIMIT:tenant_missing' using errcode = 'P0001';
  end if;
  if v_plan = 'suspended' then
    raise exception 'FORMBOOK_LIMIT:suspended' using errcode = 'P0001';
  end if;
  select pl.max_pixels into v_max from public.plan_limits pl where pl.plan = v_plan;
  if v_max is null then
    raise exception 'FORMBOOK_LIMIT:unknown_plan' using errcode = 'P0001';
  end if;
  select count(*) into v_count from public.meta_pixels p
  where p.tenant_id = new.tenant_id and p.id <> new.id and p.frozen_at is null;
  if v_count >= v_max then
    raise exception 'FORMBOOK_LIMIT:pixels' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists meta_pixels_enforce_limit on public.meta_pixels;
create trigger meta_pixels_enforce_limit
before insert or update of tenant_id, frozen_at on public.meta_pixels
for each row execute function public.enforce_meta_pixel_limit();

-- 6. Platform columns stay service-role only (adds account_ref and frozen_at to the 0024 guards).
-- Both stay security invoker on purpose, as in 0024; their triggers already exist and are not recreated.
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
    new.signup_source is distinct from old.signup_source or
    new.account_ref is distinct from old.account_ref
  ) then
    raise exception 'FORMBOOK_FORBIDDEN:tenant_platform_columns' using errcode = '42501';
  end if;
  return new;
end;
$$;

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
    new.taken_down_reason is distinct from old.taken_down_reason or
    new.frozen_at is distinct from old.frozen_at
  ) then
    raise exception 'FORMBOOK_FORBIDDEN:funnel_platform_columns' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- 7. Activity reads for the ranking. Ties break on created_at, never updated_at:
-- the freeze, restore and swap bump updated_at (funnels_set_updated_at) and
-- would reorder forms on the next downgrade. The drop lets a rerun change the
-- return type; grants are applied again in section 11.
drop function if exists public.tenant_form_activity(uuid);
create or replace function public.tenant_form_activity(p_tenant_id uuid)
returns table (
  funnel_id uuid, name text, is_published boolean, frozen_at timestamptz, taken_down_at timestamptz,
  updated_at timestamptz, meta_pixel_id uuid, last_lead_at timestamptz, created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.name, f.is_published, f.frozen_at, f.taken_down_at, f.updated_at, f.meta_pixel_id,
    (select max(ls.created_at) from public.lead_sessions ls where ls.funnel_id = f.id),
    f.created_at
  from public.funnels f
  where f.tenant_id = p_tenant_id
$$;

create or replace function public.tenant_pixel_activity(p_tenant_id uuid)
returns table (pixel_id uuid, name text, frozen_at timestamptz, created_at timestamptz, last_event_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.name, p.frozen_at, p.created_at,
    (select max(d.created_at) from public.meta_event_deliveries d where d.pixel_id = p.id)
  from public.meta_pixels p
  where p.tenant_id = p_tenant_id
$$;

-- 8. Apply a plan change: tenant fields, freeze, restore, end tests, history. One transaction.
create or replace function public.apply_tenant_plan_change(
  p_tenant_id uuid,
  p_expected_plan text,
  p_plan text,
  p_plan_before_suspension text,
  p_suspended_at timestamptz,
  p_suspension_reason text,
  p_form_keep_order uuid[],
  p_pixel_keep_order uuid[],
  p_restorable_form_ids uuid[],
  p_source text,
  p_actor text,
  p_note text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
  v_limits public.plan_limits%rowtype;
  v_count integer;
  v_slots integer;
  v_frozen_forms uuid[] := '{}';
  v_frozen_pixels uuid[] := '{}';
  v_restored_forms uuid[] := '{}';
  v_restored_pixels uuid[] := '{}';
  v_ended integer := 0;
  v_history uuid;
begin
  if p_plan is null or p_plan not in ('free', 'scaling', 'suspended') then
    raise exception 'FORMBOOK_PLAN:invalid_plan' using errcode = 'P0001';
  end if;
  if p_source is null or p_source not in ('provision', 'owner') then
    raise exception 'FORMBOOK_PLAN:invalid_source' using errcode = 'P0001';
  end if;

  select t.plan into v_old from public.tenants t where t.id = p_tenant_id for update;
  if not found then
    raise exception 'FORMBOOK_PLAN:tenant_missing' using errcode = 'P0001';
  end if;
  if v_old is distinct from p_expected_plan then
    raise exception 'FORMBOOK_PLAN:changed' using errcode = 'P0001';
  end if;

  update public.tenants
  set plan = p_plan,
      plan_before_suspension = p_plan_before_suspension,
      suspended_at = p_suspended_at,
      suspension_reason = left(p_suspension_reason, 500)
  where id = p_tenant_id;

  if p_plan <> 'suspended' then
    select * into v_limits from public.plan_limits pl where pl.plan = p_plan;
    if not found then
      raise exception 'FORMBOOK_LIMIT:unknown_plan' using errcode = 'P0001';
    end if;

    -- Freeze active forms beyond the limit, keeping the ranked ones.
    select coalesce(array_agg(r.id), '{}') into v_frozen_forms from (
      select f.id from public.funnels f
      where f.tenant_id = p_tenant_id and f.is_published
      order by array_position(coalesce(p_form_keep_order, '{}'), f.id) nulls last, f.created_at desc, f.id
      offset v_limits.max_active_forms
    ) r;
    if cardinality(v_frozen_forms) > 0 then
      update public.funnels set is_published = false, frozen_at = now()
      where tenant_id = p_tenant_id and id = any(v_frozen_forms);
      update public.split_tests t set status = 'ended', end_reason = 'form_frozen'
      where t.tenant_id = p_tenant_id and t.status = 'running'
        and exists (select 1 from public.split_test_members m where m.test_id = t.id and m.funnel_id = any(v_frozen_forms));
      get diagnostics v_ended = row_count;
    end if;

    -- Freeze pixels beyond the limit.
    select coalesce(array_agg(r.id), '{}') into v_frozen_pixels from (
      select p.id from public.meta_pixels p
      where p.tenant_id = p_tenant_id and p.frozen_at is null
      order by array_position(coalesce(p_pixel_keep_order, '{}'), p.id) nulls last, p.created_at desc, p.id
      offset v_limits.max_pixels
    ) r;
    if cardinality(v_frozen_pixels) > 0 then
      update public.meta_pixels set frozen_at = now()
      where tenant_id = p_tenant_id and id = any(v_frozen_pixels);
    end if;

    -- Restore frozen forms into free slots (only forms the app checked as ready).
    if cardinality(v_frozen_forms) = 0 and coalesce(cardinality(p_restorable_form_ids), 0) > 0 then
      select count(*) into v_count from public.funnels f where f.tenant_id = p_tenant_id and f.is_published;
      v_slots := v_limits.max_active_forms - v_count;
      if v_slots > 0 then
        select coalesce(array_agg(r.id), '{}') into v_restored_forms from (
          select f.id from public.funnels f
          where f.tenant_id = p_tenant_id and f.frozen_at is not null and not f.is_published
            and f.taken_down_at is null and f.id = any(p_restorable_form_ids)
          order by array_position(p_restorable_form_ids, f.id), f.id
          limit v_slots
        ) r;
        if cardinality(v_restored_forms) > 0 then
          update public.funnels set is_published = true, frozen_at = null
          where tenant_id = p_tenant_id and id = any(v_restored_forms);
        end if;
      end if;
    end if;

    -- Restore frozen pixels into free slots.
    if cardinality(v_frozen_pixels) = 0 then
      select count(*) into v_count from public.meta_pixels p where p.tenant_id = p_tenant_id and p.frozen_at is null;
      v_slots := v_limits.max_pixels - v_count;
      if v_slots > 0 then
        select coalesce(array_agg(r.id), '{}') into v_restored_pixels from (
          select p.id from public.meta_pixels p
          where p.tenant_id = p_tenant_id and p.frozen_at is not null
          order by p.frozen_at desc, p.created_at desc, p.id
          limit v_slots
        ) r;
        if cardinality(v_restored_pixels) > 0 then
          update public.meta_pixels set frozen_at = null
          where tenant_id = p_tenant_id and id = any(v_restored_pixels);
        end if;
      end if;
    end if;
  end if;

  insert into public.tenant_plan_changes (
    tenant_id, from_plan, to_plan, source, actor, note,
    frozen_forms, frozen_pixels, restored_forms, restored_pixels, ended_split_tests, details
  ) values (
    p_tenant_id, v_old, p_plan, p_source, left(p_actor, 254), left(p_note, 500),
    cardinality(v_frozen_forms), cardinality(v_frozen_pixels),
    cardinality(v_restored_forms), cardinality(v_restored_pixels), v_ended,
    jsonb_build_object(
      'frozen_form_ids', to_jsonb(v_frozen_forms), 'frozen_pixel_ids', to_jsonb(v_frozen_pixels),
      'restored_form_ids', to_jsonb(v_restored_forms), 'restored_pixel_ids', to_jsonb(v_restored_pixels)
    )
  ) returning id into v_history;

  return jsonb_build_object(
    'history_id', v_history, 'from', v_old, 'to', p_plan,
    'frozen_forms', cardinality(v_frozen_forms), 'frozen_pixels', cardinality(v_frozen_pixels),
    'restored_forms', cardinality(v_restored_forms), 'restored_pixels', cardinality(v_restored_pixels),
    'ended_split_tests', v_ended
  );
end;
$$;

-- 9. Tenant swap: freeze one active form and activate one frozen form.
create or replace function public.swap_frozen_form(p_tenant_id uuid, p_freeze_id uuid, p_restore_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_ended integer := 0;
begin
  if p_freeze_id is null or p_restore_id is null or p_freeze_id = p_restore_id then
    raise exception 'FORMBOOK_FREEZE:same_form' using errcode = 'P0001';
  end if;
  select t.plan into v_plan from public.tenants t where t.id = p_tenant_id for update;
  if not found then
    raise exception 'FORMBOOK_PLAN:tenant_missing' using errcode = 'P0001';
  end if;
  if v_plan = 'suspended' then
    raise exception 'FORMBOOK_LIMIT:suspended' using errcode = 'P0001';
  end if;
  perform 1 from public.funnels f where f.id = p_freeze_id and f.tenant_id = p_tenant_id and f.is_published for update;
  if not found then
    raise exception 'FORMBOOK_FREEZE:not_active' using errcode = 'P0001';
  end if;
  perform 1 from public.funnels f
  where f.id = p_restore_id and f.tenant_id = p_tenant_id and f.frozen_at is not null
    and not f.is_published and f.taken_down_at is null
  for update;
  if not found then
    raise exception 'FORMBOOK_FREEZE:not_frozen' using errcode = 'P0001';
  end if;

  update public.funnels set is_published = false, frozen_at = now() where id = p_freeze_id and tenant_id = p_tenant_id;
  update public.split_tests t set status = 'ended', end_reason = 'form_frozen'
  where t.tenant_id = p_tenant_id and t.status = 'running'
    and exists (select 1 from public.split_test_members m where m.test_id = t.id and m.funnel_id = p_freeze_id);
  get diagnostics v_ended = row_count;
  update public.funnels set is_published = true, frozen_at = null where id = p_restore_id and tenant_id = p_tenant_id;

  return jsonb_build_object('ended_split_tests', v_ended);
end;
$$;

-- 10. Meta settle: a "pixel_frozen" wait clears like a "form_paused" wait once the row is sent or retried.
-- Same signature and body as 0027 apart from the reasons that clear.
create or replace function public.settle_meta_delivery(
  p_id uuid, p_owner uuid, p_outcome text, p_error text default null,
  p_reason text default null, p_response jsonb default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts integer;
  v_max integer;
  v_backoff integer;
  v_response jsonb := case
    when p_response is null then null
    when pg_column_size(p_response) > 8192 then '{"truncated": true}'::jsonb
    else p_response end;
begin
  if p_outcome not in ('sent', 'retry', 'failed', 'skipped', 'deferred') then
    raise exception 'settle_meta_delivery: unknown outcome %', p_outcome;
  end if;
  select attempts, max_attempts into v_attempts, v_max
  from public.meta_event_deliveries where id = p_id and lease_owner = p_owner for update;
  if not found then
    return false;
  end if;
  if p_outcome = 'deferred' then
    -- The form is unpublished, the pixel is frozen or the tenant is suspended: a pause, not a
    -- final skip. The row stays pending, the attempt is refunded, and it is checked again in
    -- 15 minutes; meta_housekeeping expires it after 7 days.
    update public.meta_event_deliveries
    set status = 'pending',
        status_reason = coalesce(left(p_reason, 60), status_reason),
        attempts = greatest(attempts - 1, 0),
        next_attempt_at = now() + interval '900 seconds',
        lease_owner = null, lease_expires_at = null, updated_at = now()
    where id = p_id;
  elsif p_outcome = 'retry' then
    v_backoff := least(30 * power(2, greatest(v_attempts - 1, 0))::integer, 3600);
    update public.meta_event_deliveries
    set status = case when v_attempts >= v_max then 'failed' else 'pending' end,
        status_reason = case when v_attempts >= v_max then 'retry_budget'
                             when status_reason in ('form_paused', 'pixel_frozen') then null else status_reason end,
        last_error = left(case when v_attempts >= v_max then coalesce(p_error, '') || ' (retry budget used up)' else p_error end, 500),
        meta_response = coalesce(v_response, meta_response),
        next_attempt_at = now() + make_interval(secs => v_backoff),
        lease_owner = null, lease_expires_at = null, updated_at = now()
    where id = p_id;
  else
    update public.meta_event_deliveries
    set status = p_outcome,
        status_reason = coalesce(left(p_reason, 60),
          case when status_reason in ('form_paused', 'pixel_frozen') then null else status_reason end),
        last_error = left(p_error, 500),
        meta_response = coalesce(v_response, meta_response),
        sent_at = case when p_outcome = 'sent' then now() else sent_at end,
        lease_owner = null, lease_expires_at = null, updated_at = now()
    where id = p_id;
  end if;
  return true;
end;
$$;

-- 11. Service role only.
revoke all on table public.tenant_plan_changes from anon, authenticated;
grant select, insert, update, delete on table public.tenant_plan_changes to service_role;
revoke all on function public.enforce_funnel_plan_limits() from public, anon, authenticated;
revoke all on function public.clear_funnel_frozen_on_activate() from public, anon, authenticated;
revoke all on function public.enforce_meta_pixel_limit() from public, anon, authenticated;
revoke all on function public.tenant_form_activity(uuid) from public, anon, authenticated;
revoke all on function public.tenant_pixel_activity(uuid) from public, anon, authenticated;
revoke all on function public.apply_tenant_plan_change(uuid, text, text, text, timestamptz, text, uuid[], uuid[], uuid[], text, text, text) from public, anon, authenticated;
revoke all on function public.swap_frozen_form(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.settle_meta_delivery(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.enforce_funnel_plan_limits() to service_role;
grant execute on function public.clear_funnel_frozen_on_activate() to service_role;
grant execute on function public.enforce_meta_pixel_limit() to service_role;
grant execute on function public.tenant_form_activity(uuid) to service_role;
grant execute on function public.tenant_pixel_activity(uuid) to service_role;
grant execute on function public.apply_tenant_plan_change(uuid, text, text, text, timestamptz, text, uuid[], uuid[], uuid[], text, text, text) to service_role;
grant execute on function public.swap_frozen_form(uuid, uuid, uuid) to service_role;
grant execute on function public.settle_meta_delivery(uuid, uuid, text, text, text, jsonb) to service_role;

notify pgrst, 'reload schema';
