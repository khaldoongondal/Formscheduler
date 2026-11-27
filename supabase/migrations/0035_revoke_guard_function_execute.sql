-- The two guard trigger functions from 0024 kept the default execute grant.
-- They only do work inside their triggers, so the API roles do not need it.
-- Safe to run twice.
revoke all on function public.guard_tenant_platform_columns() from public, anon, authenticated;
revoke all on function public.guard_funnel_platform_columns() from public, anon, authenticated;
grant execute on function public.guard_tenant_platform_columns() to service_role;
grant execute on function public.guard_funnel_platform_columns() to service_role;
