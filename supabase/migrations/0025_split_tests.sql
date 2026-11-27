-- FormBook Sprint 2 P1: split tests. Additive and safe to run twice.

-- New browser event: the visitor started filling in the form.
alter type public.analytics_event_type add value if not exists 'form_start';

create table if not exists public.split_tests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  slug text not null check (
    char_length(slug) between 3 and 80
    and slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
    and position('--' in slug) = 0
  ),
  status text not null default 'draft' check (status in ('draft', 'running', 'ended')),
  winner_funnel_id uuid references public.funnels(id) on delete set null,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint split_tests_started_when_live check (status = 'draft' or started_at is not null),
  constraint split_tests_winner_only_when_ended check (winner_funnel_id is null or status = 'ended')
);
create unique index if not exists split_tests_slug_unique_idx on public.split_tests (slug);
create index if not exists split_tests_tenant_created_idx on public.split_tests (tenant_id, created_at desc);
alter table public.split_tests enable row level security;
drop trigger if exists split_tests_set_updated_at on public.split_tests;
create trigger split_tests_set_updated_at before update on public.split_tests
for each row execute function set_updated_at();

create table if not exists public.split_test_members (
  test_id uuid not null references public.split_tests(id) on delete cascade,
  funnel_id uuid not null references public.funnels(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  position smallint not null check (position between 1 and 3),
  created_at timestamptz not null default now(),
  primary key (test_id, funnel_id),
  unique (test_id, position)
);
create index if not exists split_test_members_funnel_idx on public.split_test_members (funnel_id);
alter table public.split_test_members enable row level security;

-- Assignment recorded on every analytics row and lead session of a running test.
alter table public.analytics_events
  add column if not exists split_test_id uuid references public.split_tests(id) on delete set null;
alter table public.lead_sessions
  add column if not exists split_test_id uuid references public.split_tests(id) on delete set null;
create index if not exists analytics_events_split_test_time_idx
  on public.analytics_events (split_test_id, occurred_at) where split_test_id is not null;
create index if not exists lead_sessions_split_test_idx
  on public.lead_sessions (split_test_id) where split_test_id is not null;

-- Members: same tenant, at most 3, only while the test is a draft.
-- Deletes are not blocked here (a deleted form cascades); the app blocks
-- removing members from a test that is not a draft.
create or replace function public.enforce_split_test_member_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_test public.split_tests%rowtype;
  v_funnel_tenant uuid;
  v_count integer;
begin
  select * into v_test from public.split_tests where id = new.test_id for update;
  if not found then
    raise exception 'FORMBOOK_SPLIT:test_missing' using errcode = 'P0001';
  end if;
  if v_test.status <> 'draft' then
    raise exception 'FORMBOOK_SPLIT:locked' using errcode = 'P0001';
  end if;
  select f.tenant_id into v_funnel_tenant from public.funnels f where f.id = new.funnel_id;
  if new.tenant_id is distinct from v_test.tenant_id or v_funnel_tenant is distinct from v_test.tenant_id then
    raise exception 'FORMBOOK_SPLIT:wrong_tenant' using errcode = 'P0001';
  end if;
  select count(*) into v_count from public.split_test_members m
  where m.test_id = new.test_id
    and (tg_op = 'INSERT' or not (m.test_id = old.test_id and m.funnel_id = old.funnel_id));
  if v_count >= 3 then
    raise exception 'FORMBOOK_SPLIT:too_many_forms' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists split_test_members_enforce_rules on public.split_test_members;
create trigger split_test_members_enforce_rules
before insert or update on public.split_test_members
for each row execute function public.enforce_split_test_member_rules();

-- Test state changes. Starting locks the member forms, so two tests that
-- share a form cannot both start (decision S6).
create or replace function public.enforce_split_test_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'FORMBOOK_SPLIT:bad_transition' using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'FORMBOOK_SPLIT:wrong_tenant' using errcode = 'P0001';
  end if;
  if old.status <> 'draft' and new.slug is distinct from old.slug then
    raise exception 'FORMBOOK_SPLIT:locked' using errcode = 'P0001';
  end if;

  if new.status is distinct from old.status then
    if not ((old.status = 'draft' and new.status = 'running')
         or (old.status = 'running' and new.status = 'ended')) then
      raise exception 'FORMBOOK_SPLIT:bad_transition' using errcode = 'P0001';
    end if;

    if new.status = 'running' then
      perform 1 from public.funnels f
      join public.split_test_members m on m.funnel_id = f.id
      where m.test_id = new.id
      for update of f;

      select count(*) into v_count from public.split_test_members m where m.test_id = new.id;
      if v_count < 2 then
        raise exception 'FORMBOOK_SPLIT:needs_two_forms' using errcode = 'P0001';
      end if;
      if v_count > 3 then
        raise exception 'FORMBOOK_SPLIT:too_many_forms' using errcode = 'P0001';
      end if;
      if exists (
        select 1 from public.split_test_members m
        join public.funnels f on f.id = m.funnel_id
        where m.test_id = new.id
          and (not f.is_published or f.taken_down_at is not null or f.tenant_id <> new.tenant_id)
      ) then
        raise exception 'FORMBOOK_SPLIT:form_not_active' using errcode = 'P0001';
      end if;
      if exists (
        select 1 from public.split_test_members m
        join public.split_test_members other on other.funnel_id = m.funnel_id and other.test_id <> m.test_id
        join public.split_tests t on t.id = other.test_id
        where m.test_id = new.id and t.status = 'running'
      ) then
        raise exception 'FORMBOOK_SPLIT:form_in_running_test' using errcode = 'P0001';
      end if;
      new.started_at := coalesce(new.started_at, now());
      new.ended_at := null;
    elsif new.status = 'ended' then
      new.ended_at := coalesce(new.ended_at, now());
    end if;
  end if;

  if new.winner_funnel_id is not null and new.winner_funnel_id is distinct from old.winner_funnel_id then
    if new.status <> 'ended' then
      raise exception 'FORMBOOK_SPLIT:bad_transition' using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from public.split_test_members m
      where m.test_id = new.id and m.funnel_id = new.winner_funnel_id
    ) then
      raise exception 'FORMBOOK_SPLIT:winner_not_member' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;
drop trigger if exists split_tests_enforce_rules on public.split_tests;
create trigger split_tests_enforce_rules
before insert or update on public.split_tests
for each row execute function public.enforce_split_test_rules();

revoke all on table public.split_tests, public.split_test_members from anon, authenticated;
grant select, insert, update, delete on table public.split_tests, public.split_test_members to service_role;
revoke all on function public.enforce_split_test_member_rules() from public, anon, authenticated;
revoke all on function public.enforce_split_test_rules() from public, anon, authenticated;
grant execute on function public.enforce_split_test_member_rules() to service_role;
grant execute on function public.enforce_split_test_rules() to service_role;

notify pgrst, 'reload schema';
