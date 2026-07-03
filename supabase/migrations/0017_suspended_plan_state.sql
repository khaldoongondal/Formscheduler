alter table tenants drop constraint if exists tenants_plan_check;

alter table tenants
  add constraint tenants_plan_check check (plan in ('tier1', 'tier2', 'tier3', 'suspended'));

notify pgrst, 'reload schema';
