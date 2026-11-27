-- FormBook Sprint 3 P2: one FormBook booking per connection and start time. Additive, safe to run twice.
-- Rows written before migration 0029 have calendar_connection_id null, so the index cannot fail to build.
create unique index if not exists booking_attempts_connection_slot_uidx
  on public.booking_attempts (calendar_connection_id, slot_start)
  where calendar_connection_id is not null and status in ('pending', 'booked');
create index if not exists booking_attempts_connection_pending_idx
  on public.booking_attempts (calendar_connection_id, created_at)
  where status = 'pending';
notify pgrst, 'reload schema';
