-- FormBook Sprint 3 P3: durable CRM delivery queue and log, Calendly booking dedupe.
-- Additive and safe to run twice.

-- 1. Queue and log.
create table if not exists public.crm_event_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid references public.connections(id) on delete cascade,
  ghl_connection_id uuid references public.ghl_connections(id) on delete cascade,
  provider text not null check (provider in ('ghl', 'hubspot', 'webhook')),
  funnel_id uuid references public.funnels(id) on delete set null,
  lead_session_id uuid references public.lead_sessions(id) on delete set null,
  event_type text not null check (event_type in ('lead.captured', 'lead.qualified', 'lead.disqualified', 'lead.booked', 'test.ping')),
  event_id text not null check (char_length(event_id) <= 160),
  payload jsonb check (payload is null or pg_column_size(payload) <= 65536),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped', 'cancelled')),
  status_reason text check (status_reason is null or char_length(status_reason) <= 60),
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  next_attempt_at timestamptz not null default now(),
  lease_owner uuid,
  lease_expires_at timestamptz,
  response_status integer,
  response_summary text check (response_summary is null or char_length(response_summary) <= 500),
  last_error text check (last_error is null or char_length(last_error) <= 500),
  sent_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_event_deliveries_one_target check (
    (connection_id is not null and ghl_connection_id is null and provider in ('hubspot', 'webhook')) or
    (connection_id is null and ghl_connection_id is not null and provider = 'ghl')
  )
);
create unique index if not exists crm_event_deliveries_target_event_uidx
  on public.crm_event_deliveries ((coalesce(connection_id, ghl_connection_id)), event_id);
create index if not exists crm_event_deliveries_claimable_idx
  on public.crm_event_deliveries (next_attempt_at) where status = 'pending';
create index if not exists crm_event_deliveries_lead_order_idx
  on public.crm_event_deliveries (lead_session_id, created_at) where status = 'pending';
create index if not exists crm_event_deliveries_connection_log_idx
  on public.crm_event_deliveries (connection_id, created_at desc) where connection_id is not null;
create index if not exists crm_event_deliveries_ghl_log_idx
  on public.crm_event_deliveries (ghl_connection_id, created_at desc) where ghl_connection_id is not null;
create index if not exists crm_event_deliveries_lead_log_idx
  on public.crm_event_deliveries (lead_session_id) where lead_session_id is not null;
create index if not exists crm_event_deliveries_settled_idx
  on public.crm_event_deliveries (settled_at) where settled_at is not null;
alter table public.crm_event_deliveries enable row level security;
drop trigger if exists crm_event_deliveries_set_updated_at on public.crm_event_deliveries;
create trigger crm_event_deliveries_set_updated_at before update on public.crm_event_deliveries
for each row execute function set_updated_at();

-- 2. Claim in order: a row waits while an older pending row of the same lead and target exists.
create or replace function public.claim_crm_deliveries(p_owner uuid, p_limit integer default 10, p_lease_seconds integer default 120)
returns setof public.crm_event_deliveries
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.crm_event_deliveries
  set status = 'failed', status_reason = 'retry_budget', settled_at = now(),
      last_error = left(coalesce(last_error, '') || ' (retry budget used up)', 500),
      lease_owner = null, lease_expires_at = null
  where status = 'pending' and attempts >= max_attempts
    and (lease_expires_at is null or lease_expires_at < now());
  return query
  update public.crm_event_deliveries q
  set lease_owner = p_owner,
      lease_expires_at = now() + make_interval(secs => greatest(10, least(p_lease_seconds, 600))),
      attempts = q.attempts + 1
  where q.id in (
    select c.id from public.crm_event_deliveries c
    where c.status = 'pending' and c.attempts < c.max_attempts and c.next_attempt_at <= now()
      and (c.lease_expires_at is null or c.lease_expires_at < now())
      and (c.lead_session_id is null or not exists (
        select 1 from public.crm_event_deliveries e
        where e.lead_session_id = c.lead_session_id
          and coalesce(e.connection_id, e.ghl_connection_id) = coalesce(c.connection_id, c.ghl_connection_id)
          and e.status = 'pending' and e.created_at < c.created_at
      ))
    order by c.created_at
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  )
  returning q.*;
end;
$$;

create or replace function public.claim_crm_deliveries_by_ids(p_ids uuid[], p_owner uuid, p_lease_seconds integer default 60)
returns setof public.crm_event_deliveries
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.crm_event_deliveries q
  set lease_owner = p_owner,
      lease_expires_at = now() + make_interval(secs => greatest(10, least(p_lease_seconds, 600))),
      attempts = q.attempts + 1
  where q.id in (
    select c.id from public.crm_event_deliveries c
    where c.id = any(p_ids) and c.status = 'pending' and c.attempts < c.max_attempts
      and c.next_attempt_at <= now()
      and (c.lease_expires_at is null or c.lease_expires_at < now())
      and (c.lead_session_id is null or not exists (
        select 1 from public.crm_event_deliveries e
        where e.lead_session_id = c.lead_session_id
          and coalesce(e.connection_id, e.ghl_connection_id) = coalesce(c.connection_id, c.ghl_connection_id)
          and e.status = 'pending' and e.created_at < c.created_at
      ))
    order by c.created_at
    limit 20
    for update skip locked
  )
  returning q.*;
end;
$$;

create or replace function public.settle_crm_delivery(
  p_id uuid, p_owner uuid, p_outcome text, p_status integer default null,
  p_summary text default null, p_error text default null, p_reason text default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts integer;
  v_max integer;
begin
  if p_outcome not in ('sent', 'retry', 'failed', 'skipped') then
    raise exception 'settle_crm_delivery: unknown outcome %', p_outcome;
  end if;
  select attempts, max_attempts into v_attempts, v_max
  from public.crm_event_deliveries where id = p_id and lease_owner = p_owner for update;
  if not found then
    return false;
  end if;
  if p_outcome = 'retry' and v_attempts < v_max then
    update public.crm_event_deliveries
    set status = 'pending',
        next_attempt_at = now() + make_interval(secs => least(60 * power(2, greatest(v_attempts - 1, 0))::integer, 21600)),
        response_status = p_status, response_summary = left(p_summary, 500), last_error = left(p_error, 500),
        lease_owner = null, lease_expires_at = null
    where id = p_id;
  else
    update public.crm_event_deliveries
    set status = case when p_outcome = 'retry' then 'failed' else p_outcome end,
        status_reason = case when p_outcome = 'retry' then 'retry_budget' else coalesce(left(p_reason, 60), status_reason) end,
        response_status = p_status, response_summary = left(p_summary, 500), last_error = left(p_error, 500),
        sent_at = case when p_outcome = 'sent' then now() else sent_at end,
        settled_at = now(),
        lease_owner = null, lease_expires_at = null
    where id = p_id;
  end if;
  return true;
end;
$$;

create or replace function public.release_crm_delivery(p_id uuid, p_owner uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.crm_event_deliveries
  set attempts = greatest(attempts - 1, 0), lease_owner = null, lease_expires_at = null
  where id = p_id and lease_owner = p_owner and status = 'pending';
  return found;
end;
$$;

-- Tenant "Send again" for a failed row; tenant checked inside.
create or replace function public.retry_crm_delivery(p_id uuid, p_tenant_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.crm_event_deliveries
  set status = 'pending', status_reason = 'manual_retry', attempts = 0, next_attempt_at = now(),
      settled_at = null, lease_owner = null, lease_expires_at = null
  where id = p_id and tenant_id = p_tenant_id and status = 'failed' and payload is not null
    and event_type <> 'test.ping';
  return found;
end;
$$;

create or replace function public.crm_housekeeping()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired integer;
  v_wiped integer;
  v_deleted integer;
begin
  update public.crm_event_deliveries
  set status = 'failed', status_reason = 'expired', settled_at = now(), lease_owner = null, lease_expires_at = null
  where status = 'pending' and created_at < now() - interval '3 days'
    and (lease_expires_at is null or lease_expires_at < now());
  get diagnostics v_expired = row_count;
  update public.crm_event_deliveries set payload = null
  where payload is not null and settled_at < now() - interval '30 days';
  get diagnostics v_wiped = row_count;
  delete from public.crm_event_deliveries where settled_at < now() - interval '90 days';
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('expired', v_expired, 'wiped', v_wiped, 'deleted', v_deleted);
end;
$$;

-- 3. One FormBook booking per external booking (Calendly invitee URI) and connection.
create unique index if not exists booking_attempts_connection_external_uidx
  on public.booking_attempts (calendar_connection_id, external_booking_id)
  where calendar_connection_id is not null and external_booking_id is not null;

-- 4. Service role only.
revoke all on table public.crm_event_deliveries from anon, authenticated;
grant select, insert, update, delete on table public.crm_event_deliveries to service_role;
revoke all on function public.claim_crm_deliveries(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.claim_crm_deliveries_by_ids(uuid[], uuid, integer) from public, anon, authenticated;
revoke all on function public.settle_crm_delivery(uuid, uuid, text, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.release_crm_delivery(uuid, uuid) from public, anon, authenticated;
revoke all on function public.retry_crm_delivery(uuid, uuid) from public, anon, authenticated;
revoke all on function public.crm_housekeeping() from public, anon, authenticated;
grant execute on function public.claim_crm_deliveries(uuid, integer, integer) to service_role;
grant execute on function public.claim_crm_deliveries_by_ids(uuid[], uuid, integer) to service_role;
grant execute on function public.settle_crm_delivery(uuid, uuid, text, integer, text, text, text) to service_role;
grant execute on function public.release_crm_delivery(uuid, uuid) to service_role;
grant execute on function public.retry_crm_delivery(uuid, uuid) to service_role;
grant execute on function public.crm_housekeeping() to service_role;

notify pgrst, 'reload schema';
