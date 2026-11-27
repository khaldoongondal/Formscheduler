-- FormBook Sprint 2 P2: ad spend the user enters. Additive and safe to run twice.

create table if not exists public.ad_spend_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  funnel_id uuid not null references public.funnels(id) on delete cascade,
  split_test_id uuid references public.split_tests(id) on delete cascade,
  period_start date,
  period_end date,
  amount_cents bigint not null check (amount_cents between 0 and 100000000000),
  currency text not null default 'USD' check (currency in ('USD', 'CAD', 'EUR', 'GBP', 'AUD')),
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_spend_entries_period check (
    split_test_id is not null
    or (period_start is not null and period_end is not null and period_end >= period_start)
  )
);
create unique index if not exists ad_spend_entries_test_funnel_idx
  on public.ad_spend_entries (split_test_id, funnel_id) where split_test_id is not null;
create index if not exists ad_spend_entries_funnel_period_idx
  on public.ad_spend_entries (funnel_id, period_start) where split_test_id is null;
alter table public.ad_spend_entries enable row level security;
drop trigger if exists ad_spend_entries_set_updated_at on public.ad_spend_entries;
create trigger ad_spend_entries_set_updated_at before update on public.ad_spend_entries
for each row execute function set_updated_at();

create or replace function public.enforce_ad_spend_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.funnels f where f.id = new.funnel_id and f.tenant_id = new.tenant_id) then
    raise exception 'FORMBOOK_SPEND:wrong_tenant' using errcode = 'P0001';
  end if;
  if new.split_test_id is not null and not exists (
    select 1 from public.split_test_members m
    join public.split_tests t on t.id = m.test_id
    where m.test_id = new.split_test_id and m.funnel_id = new.funnel_id and t.tenant_id = new.tenant_id
  ) then
    raise exception 'FORMBOOK_SPEND:not_member' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists ad_spend_entries_enforce_scope on public.ad_spend_entries;
create trigger ad_spend_entries_enforce_scope
before insert or update on public.ad_spend_entries
for each row execute function public.enforce_ad_spend_scope();

revoke all on table public.ad_spend_entries from anon, authenticated;
grant select, insert, update, delete on table public.ad_spend_entries to service_role;
revoke all on function public.enforce_ad_spend_scope() from public, anon, authenticated;
grant execute on function public.enforce_ad_spend_scope() to service_role;

notify pgrst, 'reload schema';
