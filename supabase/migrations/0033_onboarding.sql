-- FormBook Sprint 4 P2: onboarding progress and dismissals, template used per form.
-- Additive and safe to run twice. Every existing row stays valid: the new table
-- starts empty (missing row means nothing marked) and template_key is null for
-- every existing form.

-- 1. Onboarding steps that leave no other trace, and the two dismissals (decision D15).
create table if not exists public.tenant_onboarding (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  preview_opened_at timestamptz,
  embed_copied_at timestamptz,
  checklist_hidden_at timestamptz,
  setup_call_dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.tenant_onboarding enable row level security;
drop trigger if exists tenant_onboarding_set_updated_at on public.tenant_onboarding;
create trigger tenant_onboarding_set_updated_at before update on public.tenant_onboarding
for each row execute function public.set_updated_at();

-- Marks one step or dismissal once (first time wins); clearing is only for checklist_hidden_at.
create or replace function public.mark_tenant_onboarding(p_tenant_id uuid, p_field text, p_clear boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_field is null or p_field not in ('preview_opened_at', 'embed_copied_at', 'checklist_hidden_at', 'setup_call_dismissed_at') then
    raise exception 'FORMBOOK_ONBOARDING:bad_field' using errcode = 'P0001';
  end if;
  if coalesce(p_clear, false) and p_field <> 'checklist_hidden_at' then
    raise exception 'FORMBOOK_ONBOARDING:bad_field' using errcode = 'P0001';
  end if;
  insert into public.tenant_onboarding (tenant_id) values (p_tenant_id) on conflict (tenant_id) do nothing;
  if coalesce(p_clear, false) then
    update public.tenant_onboarding set checklist_hidden_at = null where tenant_id = p_tenant_id;
  else
    -- p_field is one of the four fixed names checked above; %I quotes it.
    execute format('update public.tenant_onboarding set %I = coalesce(%I, now()) where tenant_id = $1', p_field, p_field)
    using p_tenant_id;
  end if;
end;
$$;

-- 2. Starter template a form was created from (decision D17). Null for blank and existing forms.
alter table public.funnels add column if not exists template_key text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'funnels_template_key_format') then
    alter table public.funnels add constraint funnels_template_key_format
      check (template_key is null or template_key ~ '^[a-z_]{2,40}$');
  end if;
end $$;

-- 3. Service role only.
revoke all on table public.tenant_onboarding from anon, authenticated;
grant select, insert, update, delete on table public.tenant_onboarding to service_role;
revoke all on function public.mark_tenant_onboarding(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.mark_tenant_onboarding(uuid, text, boolean) to service_role;

notify pgrst, 'reload schema';
