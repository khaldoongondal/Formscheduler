-- FormBook Sprint 3 P2: one pending FormBook booking per connection and start time. Additive, safe to run twice.
-- Rows written before migration 0029 have calendar_connection_id null, so the indexes cannot fail to build.
-- Only pending rows are unique: cancellations on Google and Cal.com are not tracked (decision C27), so a
-- booked row must never hold its time forever. Overlapping and buffer-adjacent starts, and a booking made in
-- the last few minutes, are refused in application code (lib/bookings/booking-guard.ts): each request inserts
-- its pending hold, then yields when another live hold conflicts. After that the calendar's own check decides.
-- An earlier draft of this file (never applied to production) made booked rows unique too; drop that index
-- if a development database has it.
drop index if exists public.booking_attempts_connection_slot_uidx;
create unique index if not exists booking_attempts_connection_pending_slot_uidx
  on public.booking_attempts (calendar_connection_id, slot_start)
  where calendar_connection_id is not null and status = 'pending';
-- Range lookup of live holds by connection and start time.
create index if not exists booking_attempts_connection_live_slot_idx
  on public.booking_attempts (calendar_connection_id, slot_start)
  where calendar_connection_id is not null and status in ('pending', 'booked');
create index if not exists booking_attempts_connection_pending_idx
  on public.booking_attempts (calendar_connection_id, created_at)
  where status = 'pending';
notify pgrst, 'reload schema';
