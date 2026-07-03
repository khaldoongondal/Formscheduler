import { z } from "zod";

export const slotLookupSchema = z.object({
  lead_session_id: z.string().uuid(),
  timezone: z.string().min(2).max(80)
});

export const bookAppointmentSchema = z.object({
  lead_session_id: z.string().uuid(),
  slot_start: z.string().datetime({ offset: true }),
  slot_end: z.string().datetime({ offset: true }),
  timezone: z.string().min(2).max(80)
});
