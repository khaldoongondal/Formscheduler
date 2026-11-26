-- FormBook Sprint 1, package P2: rate limits, form takedown, connection tenant
-- check, form reports and logo mime types. Additive and safe to run twice.

-- Rate limit counters (service role only).
create table if not exists public.rate_limit_counters (
  bucket_key text primary key check (char_length(bucket_key) <= 200),
  hits integer not null default 0,
  expires_at timestamptz not null
);
create index if not exists rate_limit_counters_expires_idx on public.rate_limit_counters (expires_at);
alter table public.rate_limit_counters enable row level security;

-- Atomic fixed-window counter. The caller puts the window start into the key,
-- so each window gets a fresh row. Returns the hit count including this hit.
create or replace function public.rate_limit_hit(p_bucket_key text, p_window_seconds integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits integer;
begin
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 172800 then
    raise exception 'rate_limit_hit: invalid window' using errcode = '22023';
  end if;
  insert into public.rate_limit_counters as c (bucket_key, hits, expires_at)
  values (p_bucket_key, 1, now() + make_interval(secs => p_window_seconds))
  on conflict (bucket_key) do update set hits = c.hits + 1
  returning c.hits into v_hits;

  -- Occasional cleanup of expired windows.
  if random() < 0.01 then
    delete from public.rate_limit_counters where expires_at < now() - interval '1 hour';
  end if;
  return v_hits;
end;
$$;
revoke all on function public.rate_limit_hit(text, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer) to service_role;

-- Form takedown.
alter table public.funnels
  add column if not exists taken_down_at timestamptz,
  add column if not exists taken_down_reason text;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'funnels_taken_down_reason_length' and conrelid = 'public.funnels'::regclass
  ) then
    alter table public.funnels add constraint funnels_taken_down_reason_length
      check (taken_down_reason is null or char_length(taken_down_reason) <= 500);
  end if;
end $$;

create or replace function public.block_publish_when_taken_down()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_published and new.taken_down_at is not null then
    raise exception 'FORMBOOK_LIMIT:taken_down' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists funnels_block_publish_when_taken_down on public.funnels;
create trigger funnels_block_publish_when_taken_down
before insert or update of is_published, taken_down_at on public.funnels
for each row execute function public.block_publish_when_taken_down();

-- A form may only use a GoHighLevel connection from its own tenant.
-- Data fix: clear cross-tenant references (a security bug). Rows stay valid.
update public.funnels f
set ghl_connection_id = null
where f.ghl_connection_id is not null
  and not exists (
    select 1 from public.ghl_connections c
    where c.id = f.ghl_connection_id and c.tenant_id = f.tenant_id
  );

create or replace function public.enforce_funnel_connection_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.ghl_connection_id is not null and not exists (
    select 1 from public.ghl_connections c
    where c.id = new.ghl_connection_id and c.tenant_id = new.tenant_id
  ) then
    raise exception 'FORMBOOK_INVALID:ghl_connection' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists funnels_enforce_connection_tenant on public.funnels;
create trigger funnels_enforce_connection_tenant
before insert or update of ghl_connection_id, tenant_id on public.funnels
for each row execute function public.enforce_funnel_connection_tenant();

-- Form reports (service role only).
create table if not exists public.form_reports (
  id uuid primary key default gen_random_uuid(),
  funnel_id uuid references public.funnels(id) on delete set null,
  tenant_id uuid references public.tenants(id) on delete cascade,
  funnel_slug text not null check (char_length(funnel_slug) <= 80),
  reason text not null check (reason in ('phishing', 'spam', 'impersonation', 'illegal', 'other')),
  details text check (details is null or char_length(details) <= 1000),
  reporter_email text check (reporter_email is null or char_length(reporter_email) <= 254),
  reporter_ip_hash text check (reporter_ip_hash is null or char_length(reporter_ip_hash) <= 64),
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text check (resolved_by is null or char_length(resolved_by) <= 254)
);
create index if not exists form_reports_status_created_idx on public.form_reports (status, created_at desc);
create index if not exists form_reports_funnel_idx on public.form_reports (funnel_id);
alter table public.form_reports enable row level security;

-- Logos: no SVG from now on. Existing files keep their URLs.
update storage.buckets
set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
where id = 'funnel-assets';

notify pgrst, 'reload schema';
