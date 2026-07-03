alter table funnels
  add column if not exists redirect_url text;

alter table funnels
  drop constraint if exists funnels_redirect_url_check;

alter table funnels
  add constraint funnels_redirect_url_check
  check (redirect_url is null or redirect_url ~* '^https?://');
