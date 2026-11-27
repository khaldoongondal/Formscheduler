-- FormBook Sprint 2 P3: Meta pixels, consent settings and the server-side event queue.
-- Additive and safe to run twice.

-- 1. Pixels, limited per plan like forms.
create table if not exists public.meta_pixels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  dataset_id text not null check (dataset_id ~ '^[0-9]{5,20}$'),
  access_token_ciphertext text not null check (char_length(access_token_ciphertext) <= 4096),
  token_last_four text check (token_last_four is null or char_length(token_last_four) = 4),
  test_event_code text check (test_event_code is null or test_event_code ~ '^[A-Za-z0-9_-]{1,40}$'),
  sending_mode text not null default 'automatic' check (sending_mode in ('automatic', 'hold')),
  send_form_view boolean not null default true,
  send_form_start boolean not null default true,
  send_lead boolean not null default true,
  send_qualified_lead boolean not null default true,
  send_disqualified_lead boolean not null default false,
  send_booked_call boolean not null default true,
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_summary text check (last_test_summary is null or char_length(last_test_summary) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, dataset_id)
);
create index if not exists meta_pixels_tenant_idx on public.meta_pixels (tenant_id);
alter table public.meta_pixels enable row level security;
drop trigger if exists meta_pixels_set_updated_at on public.meta_pixels;
create trigger meta_pixels_set_updated_at before update on public.meta_pixels
for each row execute function set_updated_at();

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
  if tg_op = 'UPDATE' and new.tenant_id = old.tenant_id then
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
  select count(*) into v_count from public.meta_pixels p where p.tenant_id = new.tenant_id and p.id <> new.id;
  if v_count >= v_max then
    raise exception 'FORMBOOK_LIMIT:pixels' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists meta_pixels_enforce_limit on public.meta_pixels;
create trigger meta_pixels_enforce_limit
before insert or update of tenant_id on public.meta_pixels
for each row execute function public.enforce_meta_pixel_limit();

-- 2. Pixel choice and consent per form.
alter table public.funnels
  add column if not exists meta_pixel_id uuid references public.meta_pixels(id) on delete set null,
  add column if not exists meta_consent_confirmed_at timestamptz,
  add column if not exists meta_consent_confirmed_by text,
  add column if not exists meta_consent_checkbox_enabled boolean not null default false,
  add column if not exists meta_consent_checkbox_label text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'funnels_meta_pixel_needs_consent') then
    alter table public.funnels add constraint funnels_meta_pixel_needs_consent
      check (meta_pixel_id is null or meta_consent_confirmed_at is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'funnels_meta_consent_lengths') then
    alter table public.funnels add constraint funnels_meta_consent_lengths check (
      (meta_consent_confirmed_by is null or char_length(meta_consent_confirmed_by) <= 254) and
      (meta_consent_checkbox_label is null or char_length(meta_consent_checkbox_label) <= 300)
    );
  end if;
end $$;
create index if not exists funnels_meta_pixel_idx on public.funnels (meta_pixel_id) where meta_pixel_id is not null;

create or replace function public.enforce_funnel_pixel_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.meta_pixel_id is not null and not exists (
    select 1 from public.meta_pixels p where p.id = new.meta_pixel_id and p.tenant_id = new.tenant_id
  ) then
    raise exception 'FORMBOOK_INVALID:meta_pixel' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists funnels_enforce_pixel_tenant on public.funnels;
create trigger funnels_enforce_pixel_tenant
before insert or update of meta_pixel_id, tenant_id on public.funnels
for each row execute function public.enforce_funnel_pixel_tenant();

-- 3. Per-lead consent and fire state.
alter table public.lead_sessions
  add column if not exists meta_consent boolean,
  add column if not exists meta_released_at timestamptz,
  add column if not exists meta_released_by text;
-- Opaque per-lead reference used in Meta event ids. Event ids are posted to the
-- embedding page, so they must never carry the session id (it authorises the
-- public lead APIs). Existing rows each get their own random value.
alter table public.lead_sessions
  add column if not exists meta_event_ref uuid not null default gen_random_uuid();
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lead_sessions_meta_released_by_length') then
    alter table public.lead_sessions add constraint lead_sessions_meta_released_by_length
      check (meta_released_by is null or char_length(meta_released_by) <= 254);
  end if;
end $$;

-- 4. Durable queue and event log in one table.
create table if not exists public.meta_event_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  pixel_id uuid not null references public.meta_pixels(id) on delete cascade,
  funnel_id uuid references public.funnels(id) on delete set null,
  lead_session_id uuid references public.lead_sessions(id) on delete set null,
  split_test_id uuid references public.split_tests(id) on delete set null,
  visitor_id text check (visitor_id is null or char_length(visitor_id) <= 128),
  event_key text not null check (event_key in (
    'form_view', 'form_start', 'lead', 'qualified_lead', 'disqualified_lead', 'booked_call', 'test_event'
  )),
  event_name text not null check (char_length(event_name) <= 50),
  event_id text not null check (char_length(event_id) <= 120),
  event_time timestamptz not null,
  payload jsonb,
  match_keys text[] not null default '{}',
  status text not null default 'pending' check (status in (
    'awaiting_consent', 'held', 'pending', 'sent', 'failed', 'skipped', 'expired', 'cancelled'
  )),
  status_reason text check (status_reason is null or char_length(status_reason) <= 60),
  attempts integer not null default 0,
  max_attempts integer not null default 6,
  next_attempt_at timestamptz not null default now(),
  lease_owner uuid,
  lease_expires_at timestamptz,
  meta_response jsonb,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  test_event_code_used text check (test_event_code_used is null or char_length(test_event_code_used) <= 40),
  fired_by text check (fired_by is null or char_length(fired_by) <= 254),
  fired_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pixel_id, event_id)
);
create index if not exists meta_event_deliveries_claimable_idx
  on public.meta_event_deliveries (next_attempt_at) where status = 'pending';
create index if not exists meta_event_deliveries_claim_order_idx
  on public.meta_event_deliveries (event_time) where status = 'pending';
create index if not exists meta_event_deliveries_pixel_created_idx
  on public.meta_event_deliveries (pixel_id, created_at desc);
create index if not exists meta_event_deliveries_pixel_event_time_idx
  on public.meta_event_deliveries (pixel_id, event_time);
create index if not exists meta_event_deliveries_lead_idx
  on public.meta_event_deliveries (lead_session_id) where lead_session_id is not null;
create index if not exists meta_event_deliveries_unlinked_visitor_idx
  on public.meta_event_deliveries (tenant_id, funnel_id, visitor_id)
  where lead_session_id is null and status in ('awaiting_consent', 'held');
create index if not exists meta_event_deliveries_waiting_idx
  on public.meta_event_deliveries (status, event_time) where status in ('awaiting_consent', 'held', 'pending');
alter table public.meta_event_deliveries enable row level security;

-- 5. Attach a visitor's pre-lead rows to the new lead and apply its consent answer.
create or replace function public.meta_link_visitor_events(
  p_tenant_id uuid, p_funnel_id uuid, p_visitor_id text, p_lead_session_id uuid,
  p_consent text, p_hold boolean
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_extra integer := 0;
begin
  if p_visitor_id is null or p_visitor_id = '' or p_consent not in ('granted', 'declined', 'not_asked') then
    return 0;
  end if;
  if p_consent = 'granted' then
    update public.meta_event_deliveries d
    set lead_session_id = p_lead_session_id,
        status = case when d.status = 'awaiting_consent'
                      then (case when p_hold then 'held' else 'pending' end)
                      else d.status end,
        next_attempt_at = now(),
        updated_at = now()
    where d.tenant_id = p_tenant_id and d.funnel_id = p_funnel_id and d.visitor_id = p_visitor_id
      and d.lead_session_id is null and d.status in ('awaiting_consent', 'held')
      and d.created_at > now() - interval '7 days';
    get diagnostics v_count = row_count;
  else
    update public.meta_event_deliveries d
    set lead_session_id = p_lead_session_id,
        status = 'cancelled',
        status_reason = case when p_consent = 'declined' then 'consent_declined' else 'no_consent' end,
        payload = null,
        match_keys = '{}',
        updated_at = now()
    where d.tenant_id = p_tenant_id and d.funnel_id = p_funnel_id and d.visitor_id = p_visitor_id
      and d.lead_session_id is null and d.status = 'awaiting_consent';
    get diagnostics v_count = row_count;
    if p_consent = 'not_asked' then
      update public.meta_event_deliveries d
      set lead_session_id = p_lead_session_id, updated_at = now()
      where d.tenant_id = p_tenant_id and d.funnel_id = p_funnel_id and d.visitor_id = p_visitor_id
        and d.lead_session_id is null and d.status = 'held'
        and d.created_at > now() - interval '7 days';
      get diagnostics v_extra = row_count;
    end if;
  end if;
  return v_count + v_extra;
end;
$$;

-- 6. Claim, settle, release (ported from Mission Control capi_delivery_queue).
create or replace function public.claim_meta_deliveries(p_owner uuid, p_limit integer default 4, p_lease_seconds integer default 120)
returns setof public.meta_event_deliveries
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.meta_event_deliveries
  set status = 'failed', status_reason = 'retry_budget',
      last_error = left(coalesce(last_error, '') || ' (retry budget used up)', 500),
      lease_owner = null, lease_expires_at = null, updated_at = now()
  where status = 'pending' and attempts >= max_attempts
    and (lease_expires_at is null or lease_expires_at < now());

  return query
  update public.meta_event_deliveries q
  set lease_owner = p_owner,
      lease_expires_at = now() + make_interval(secs => greatest(10, least(p_lease_seconds, 600))),
      attempts = q.attempts + 1,
      updated_at = now()
  where q.id in (
    select c.id from public.meta_event_deliveries c
    where c.status = 'pending' and c.attempts < c.max_attempts and c.next_attempt_at <= now()
      and (c.lease_expires_at is null or c.lease_expires_at < now())
      and c.event_time > now() - interval '7 days'
    -- Oldest events first, so a large release (Fire all) sends the rows
    -- closest to Meta's 7-day limit before they expire.
    order by c.event_time, c.next_attempt_at
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  )
  returning q.*;
end;
$$;

create or replace function public.claim_meta_deliveries_by_ids(p_ids uuid[], p_owner uuid, p_lease_seconds integer default 60)
returns setof public.meta_event_deliveries
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.meta_event_deliveries q
  set lease_owner = p_owner,
      lease_expires_at = now() + make_interval(secs => greatest(10, least(p_lease_seconds, 600))),
      attempts = q.attempts + 1,
      updated_at = now()
  where q.id in (
    select c.id from public.meta_event_deliveries c
    where c.id = any(p_ids) and c.status = 'pending' and c.attempts < c.max_attempts
      and c.next_attempt_at <= now()
      and (c.lease_expires_at is null or c.lease_expires_at < now())
      and c.event_time > now() - interval '7 days'
    limit 20
    for update skip locked
  )
  returning q.*;
end;
$$;

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
  if p_outcome not in ('sent', 'retry', 'failed', 'skipped') then
    raise exception 'settle_meta_delivery: unknown outcome %', p_outcome;
  end if;
  select attempts, max_attempts into v_attempts, v_max
  from public.meta_event_deliveries where id = p_id and lease_owner = p_owner for update;
  if not found then
    return false;
  end if;
  if p_outcome = 'retry' then
    v_backoff := least(30 * power(2, greatest(v_attempts - 1, 0))::integer, 3600);
    update public.meta_event_deliveries
    set status = case when v_attempts >= v_max then 'failed' else 'pending' end,
        status_reason = case when v_attempts >= v_max then 'retry_budget' else status_reason end,
        last_error = left(case when v_attempts >= v_max then coalesce(p_error, '') || ' (retry budget used up)' else p_error end, 500),
        meta_response = coalesce(v_response, meta_response),
        next_attempt_at = now() + make_interval(secs => v_backoff),
        lease_owner = null, lease_expires_at = null, updated_at = now()
    where id = p_id;
  else
    update public.meta_event_deliveries
    set status = p_outcome,
        status_reason = coalesce(left(p_reason, 60), status_reason),
        last_error = left(p_error, 500),
        meta_response = coalesce(v_response, meta_response),
        sent_at = case when p_outcome = 'sent' then now() else sent_at end,
        lease_owner = null, lease_expires_at = null, updated_at = now()
    where id = p_id;
  end if;
  return true;
end;
$$;

create or replace function public.release_meta_delivery(p_id uuid, p_owner uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update public.meta_event_deliveries q
  set lease_owner = null, lease_expires_at = null,
      attempts = greatest(q.attempts - 1, 0), updated_at = now()
  where q.id = p_id and q.lease_owner = p_owner and q.status = 'pending'
  returning q.id into v_id;
  return v_id is not null;
end;
$$;

-- 7. Housekeeping, run by the cron before each drain.
create or replace function public.meta_housekeeping()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired integer;
  v_cancelled integer;
  v_wiped integer;
  v_deleted integer;
begin
  update public.meta_event_deliveries
  set status = 'expired', status_reason = 'older_than_7_days', payload = null,
      lease_owner = null, lease_expires_at = null, updated_at = now()
  where status in ('awaiting_consent', 'held', 'pending')
    and event_time < now() - interval '7 days' + interval '1 hour'
    and (lease_expires_at is null or lease_expires_at < now());
  get diagnostics v_expired = row_count;

  update public.meta_event_deliveries
  set status = 'cancelled', status_reason = 'no_consent', payload = null, match_keys = '{}', updated_at = now()
  where status = 'awaiting_consent' and created_at < now() - interval '24 hours';
  get diagnostics v_cancelled = row_count;

  update public.meta_event_deliveries
  set payload = null, updated_at = now()
  where payload is not null and status in ('sent', 'failed', 'skipped', 'expired', 'cancelled')
    and created_at < now() - interval '30 days';
  get diagnostics v_wiped = row_count;

  delete from public.meta_event_deliveries
  where status in ('sent', 'failed', 'skipped', 'expired', 'cancelled')
    and created_at < now() - interval '180 days';
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('expired', v_expired, 'cancelled', v_cancelled, 'wiped', v_wiped, 'deleted', v_deleted);
end;
$$;

-- 8. API roles get nothing; the service role gets everything it uses.
revoke all on table public.meta_pixels, public.meta_event_deliveries from anon, authenticated;
grant select, insert, update, delete on table public.meta_pixels, public.meta_event_deliveries to service_role;

revoke all on function public.enforce_meta_pixel_limit() from public, anon, authenticated;
revoke all on function public.enforce_funnel_pixel_tenant() from public, anon, authenticated;
revoke all on function public.meta_link_visitor_events(uuid, uuid, text, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.claim_meta_deliveries(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.claim_meta_deliveries_by_ids(uuid[], uuid, integer) from public, anon, authenticated;
revoke all on function public.settle_meta_delivery(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.release_meta_delivery(uuid, uuid) from public, anon, authenticated;
revoke all on function public.meta_housekeeping() from public, anon, authenticated;
grant execute on function public.enforce_meta_pixel_limit() to service_role;
grant execute on function public.enforce_funnel_pixel_tenant() to service_role;
grant execute on function public.meta_link_visitor_events(uuid, uuid, text, uuid, text, boolean) to service_role;
grant execute on function public.claim_meta_deliveries(uuid, integer, integer) to service_role;
grant execute on function public.claim_meta_deliveries_by_ids(uuid[], uuid, integer) to service_role;
grant execute on function public.settle_meta_delivery(uuid, uuid, text, text, text, jsonb) to service_role;
grant execute on function public.release_meta_delivery(uuid, uuid) to service_role;
grant execute on function public.meta_housekeeping() to service_role;

notify pgrst, 'reload schema';
