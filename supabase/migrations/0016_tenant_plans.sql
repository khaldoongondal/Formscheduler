alter table tenants
  add column if not exists plan text not null default 'tier1'
  check (plan in ('tier1', 'tier2', 'tier3'));

-- Demo tenant gets unlimited so internal QA is never blocked by limits.
update tenants
set plan = 'tier3'
where id = '00000000-0000-0000-0000-000000000001';

notify pgrst, 'reload schema';
