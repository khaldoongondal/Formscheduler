-- Production security hardening for tenant isolation and role permissions.

alter table tenant_members drop constraint if exists tenant_members_role_check;

update tenant_members
set role = 'member'
where role = 'viewer';

alter table tenant_members
  alter column role set default 'member',
  add constraint tenant_members_role_check check (role in ('owner', 'admin', 'member'));

create or replace function public.current_user_tenant_ids()
returns table (tenant_id uuid)
language sql
security definer
stable
set search_path = public
as $$
  select tm.tenant_id
  from public.tenant_members tm
  where tm.user_id = auth.uid()
$$;

create or replace function public.has_tenant_role(target_tenant_id uuid, allowed_roles text[])
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_members tm
    where tm.user_id = auth.uid()
      and tm.tenant_id = target_tenant_id
      and tm.role = any(allowed_roles)
  )
$$;

revoke all on function public.current_user_tenant_ids() from public;
revoke all on function public.has_tenant_role(uuid, text[]) from public;
grant execute on function public.current_user_tenant_ids() to authenticated;
grant execute on function public.has_tenant_role(uuid, text[]) to authenticated;

alter table tenants enable row level security;
alter table tenant_members enable row level security;
alter table ghl_connections enable row level security;
alter table funnels enable row level security;
alter table questions enable row level security;
alter table question_options enable row level security;
alter table lead_sessions enable row level security;
alter table lead_status_history enable row level security;
alter table lead_answers enable row level security;
alter table booking_attempts enable row level security;
alter table analytics_events enable row level security;

drop policy if exists tenants_select_member on tenants;
create policy tenants_select_member on tenants
for select to authenticated
using (id in (select tenant_id from public.current_user_tenant_ids()));

drop policy if exists tenants_update_owner_admin on tenants;
create policy tenants_update_owner_admin on tenants
for update to authenticated
using (public.has_tenant_role(id, array['owner', 'admin']))
with check (public.has_tenant_role(id, array['owner', 'admin']));

drop policy if exists tenant_members_select_member on tenant_members;
create policy tenant_members_select_member on tenant_members
for select to authenticated
using (tenant_id in (select tenant_id from public.current_user_tenant_ids()));

drop policy if exists tenant_members_insert_owner on tenant_members;
create policy tenant_members_insert_owner on tenant_members
for insert to authenticated
with check (public.has_tenant_role(tenant_id, array['owner']));

drop policy if exists tenant_members_update_owner on tenant_members;
create policy tenant_members_update_owner on tenant_members
for update to authenticated
using (public.has_tenant_role(tenant_id, array['owner']))
with check (public.has_tenant_role(tenant_id, array['owner']));

drop policy if exists tenant_members_delete_owner on tenant_members;
create policy tenant_members_delete_owner on tenant_members
for delete to authenticated
using (public.has_tenant_role(tenant_id, array['owner']));

drop policy if exists ghl_connections_select_member on ghl_connections;
create policy ghl_connections_select_member on ghl_connections
for select to authenticated
using (public.has_tenant_role(tenant_id, array['owner', 'admin', 'member']));

drop policy if exists ghl_connections_insert_owner_admin on ghl_connections;
create policy ghl_connections_insert_owner_admin on ghl_connections
for insert to authenticated
with check (public.has_tenant_role(tenant_id, array['owner', 'admin']));

drop policy if exists ghl_connections_update_owner_admin on ghl_connections;
create policy ghl_connections_update_owner_admin on ghl_connections
for update to authenticated
using (public.has_tenant_role(tenant_id, array['owner', 'admin']))
with check (public.has_tenant_role(tenant_id, array['owner', 'admin']));

drop policy if exists ghl_connections_delete_owner_admin on ghl_connections;
create policy ghl_connections_delete_owner_admin on ghl_connections
for delete to authenticated
using (public.has_tenant_role(tenant_id, array['owner', 'admin']));

drop policy if exists funnels_select_member on funnels;
create policy funnels_select_member on funnels
for select to authenticated
using (public.has_tenant_role(tenant_id, array['owner', 'admin', 'member']));

drop policy if exists funnels_insert_owner_admin on funnels;
create policy funnels_insert_owner_admin on funnels
for insert to authenticated
with check (public.has_tenant_role(tenant_id, array['owner', 'admin']));

drop policy if exists funnels_update_owner_admin on funnels;
create policy funnels_update_owner_admin on funnels
for update to authenticated
using (public.has_tenant_role(tenant_id, array['owner', 'admin']))
with check (public.has_tenant_role(tenant_id, array['owner', 'admin']));

drop policy if exists funnels_delete_owner_admin on funnels;
create policy funnels_delete_owner_admin on funnels
for delete to authenticated
using (public.has_tenant_role(tenant_id, array['owner', 'admin']));

drop policy if exists questions_select_member on questions;
create policy questions_select_member on questions
for select to authenticated
using (public.has_tenant_role(tenant_id, array['owner', 'admin', 'member']));

drop policy if exists questions_insert_owner_admin on questions;
create policy questions_insert_owner_admin on questions
for insert to authenticated
with check (public.has_tenant_role(tenant_id, array['owner', 'admin']));

drop policy if exists questions_update_owner_admin on questions;
create policy questions_update_owner_admin on questions
for update to authenticated
using (public.has_tenant_role(tenant_id, array['owner', 'admin']))
with check (public.has_tenant_role(tenant_id, array['owner', 'admin']));

drop policy if exists questions_delete_owner_admin on questions;
create policy questions_delete_owner_admin on questions
for delete to authenticated
using (public.has_tenant_role(tenant_id, array['owner', 'admin']));

drop policy if exists question_options_select_member on question_options;
create policy question_options_select_member on question_options
for select to authenticated
using (public.has_tenant_role(tenant_id, array['owner', 'admin', 'member']));

drop policy if exists question_options_insert_owner_admin on question_options;
create policy question_options_insert_owner_admin on question_options
for insert to authenticated
with check (public.has_tenant_role(tenant_id, array['owner', 'admin']));

drop policy if exists question_options_update_owner_admin on question_options;
create policy question_options_update_owner_admin on question_options
for update to authenticated
using (public.has_tenant_role(tenant_id, array['owner', 'admin']))
with check (public.has_tenant_role(tenant_id, array['owner', 'admin']));

drop policy if exists question_options_delete_owner_admin on question_options;
create policy question_options_delete_owner_admin on question_options
for delete to authenticated
using (public.has_tenant_role(tenant_id, array['owner', 'admin']));

drop policy if exists lead_sessions_select_member on lead_sessions;
create policy lead_sessions_select_member on lead_sessions
for select to authenticated
using (public.has_tenant_role(tenant_id, array['owner', 'admin', 'member']));

drop policy if exists lead_sessions_write_owner_admin on lead_sessions;
create policy lead_sessions_write_owner_admin on lead_sessions
for all to authenticated
using (public.has_tenant_role(tenant_id, array['owner', 'admin']))
with check (public.has_tenant_role(tenant_id, array['owner', 'admin']));

drop policy if exists lead_status_history_select_member on lead_status_history;
create policy lead_status_history_select_member on lead_status_history
for select to authenticated
using (public.has_tenant_role(tenant_id, array['owner', 'admin', 'member']));

drop policy if exists lead_status_history_write_owner_admin on lead_status_history;
create policy lead_status_history_write_owner_admin on lead_status_history
for all to authenticated
using (public.has_tenant_role(tenant_id, array['owner', 'admin']))
with check (public.has_tenant_role(tenant_id, array['owner', 'admin']));

drop policy if exists lead_answers_select_member on lead_answers;
create policy lead_answers_select_member on lead_answers
for select to authenticated
using (public.has_tenant_role(tenant_id, array['owner', 'admin', 'member']));

drop policy if exists lead_answers_write_owner_admin on lead_answers;
create policy lead_answers_write_owner_admin on lead_answers
for all to authenticated
using (public.has_tenant_role(tenant_id, array['owner', 'admin']))
with check (public.has_tenant_role(tenant_id, array['owner', 'admin']));

drop policy if exists booking_attempts_select_member on booking_attempts;
create policy booking_attempts_select_member on booking_attempts
for select to authenticated
using (public.has_tenant_role(tenant_id, array['owner', 'admin', 'member']));

drop policy if exists booking_attempts_write_owner_admin on booking_attempts;
create policy booking_attempts_write_owner_admin on booking_attempts
for all to authenticated
using (public.has_tenant_role(tenant_id, array['owner', 'admin']))
with check (public.has_tenant_role(tenant_id, array['owner', 'admin']));

drop policy if exists analytics_events_select_member on analytics_events;
create policy analytics_events_select_member on analytics_events
for select to authenticated
using (public.has_tenant_role(tenant_id, array['owner', 'admin', 'member']));

drop policy if exists analytics_events_write_owner_admin on analytics_events;
create policy analytics_events_write_owner_admin on analytics_events
for all to authenticated
using (public.has_tenant_role(tenant_id, array['owner', 'admin']))
with check (public.has_tenant_role(tenant_id, array['owner', 'admin']));
