-- FormBook plans: free (Bootstrapping) and scaling (Scaling). Safe to run twice.
-- The seed below must equal PLANS in lib/billing/plans.ts.

create table if not exists public.plan_limits (
  plan text primary key check (plan in ('free', 'scaling', 'suspended')),
  display_name text not null,
  monthly_price_cents integer not null check (monthly_price_cents >= 0),
  max_active_forms integer not null check (max_active_forms >= 0),
  max_draft_forms integer not null check (max_draft_forms >= 0),
  max_pixels integer not null check (max_pixels >= 0),
  updated_at timestamptz not null default now()
);

-- Service role only: RLS on, no policies.
alter table public.plan_limits enable row level security;

insert into public.plan_limits (plan, display_name, monthly_price_cents, max_active_forms, max_draft_forms, max_pixels)
values
  ('free', 'Bootstrapping', 0, 3, 10, 1),
  ('scaling', 'Scaling', 1447, 30, 100, 3),
  ('suspended', 'Suspended', 0, 0, 0, 0)
on conflict (plan) do update set
  display_name = excluded.display_name,
  monthly_price_cents = excluded.monthly_price_cents,
  max_active_forms = excluded.max_active_forms,
  max_draft_forms = excluded.max_draft_forms,
  max_pixels = excluded.max_pixels,
  updated_at = now();

-- Move old tiers to scaling, then lock the new plan set.
alter table public.tenants drop constraint if exists tenants_plan_check;
update public.tenants set plan = 'scaling' where plan in ('tier1', 'tier2', 'tier3');
update public.tenants set plan = 'free' where plan is null or plan not in ('free', 'scaling', 'suspended');
alter table public.tenants alter column plan set default 'free';
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tenants_plan_check' and conrelid = 'public.tenants'::regclass
  ) then
    alter table public.tenants
      add constraint tenants_plan_check check (plan in ('free', 'scaling', 'suspended'));
  end if;
end $$;

-- Atomic form limits. Locking the tenant row serialises concurrent creates and activations per tenant.
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
    -- Active to Draft is always allowed (decision D5).
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
    where f.tenant_id = new.tenant_id and not f.is_published and f.id <> new.id;
    if v_count >= v_limits.max_draft_forms then
      raise exception 'FORMBOOK_LIMIT:draft_forms' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists funnels_enforce_plan_limits on public.funnels;
create trigger funnels_enforce_plan_limits
before insert or update of is_published, tenant_id on public.funnels
for each row execute function public.enforce_funnel_plan_limits();

notify pgrst, 'reload schema';
