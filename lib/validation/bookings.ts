import { z } from "zod";
import { databaseIdSchema } from "@/lib/validation/fields";

const isoTimestamp = z.iso.datetime({ offset: true }).or(z.iso.datetime({ offset: true, precision: -1 }));
// The booking API also accepts minute precision and compact offsets, e.g. 09:30-0500.
const slotTimestamp = z.string().refine((value) => {
  const withColonOffset = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  return isoTimestamp.safeParse(withColonOffset).success;
}, "Invalid datetime");

export const slotLookupSchema = z.object({
  lead_session_id: databaseIdSchema,
  timezone: z.string().min(2).max(80)
});

export const bookAppointmentSchema = z.object({
  lead_session_id: databaseIdSchema,
  slot_start: slotTimestamp,
  slot_end: slotTimestamp,
  timezone: z.string().min(2).max(80)
});
