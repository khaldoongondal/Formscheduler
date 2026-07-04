alter table ghl_connections
  add column if not exists auth_type text not null default 'token'
    check (auth_type in ('token', 'oauth')),
  add column if not exists access_token_ciphertext text,
  add column if not exists refresh_token_ciphertext text,
  add column if not exists token_expires_at timestamptz,
  add column if not exists company_id text;

notify pgrst, 'reload schema';
