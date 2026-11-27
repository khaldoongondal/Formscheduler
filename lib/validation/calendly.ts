import { z } from "zod";
import { EVENT_URI_PATTERN, INVITEE_URI_PATTERN } from "@/lib/calendly/constants";

/** Body of POST /api/bookings/calendly (the widget's event_scheduled fast path). */
export const calendlyConfirmSchema = z.object({
  lead_session_id: z.string().guid("Please refresh the page and try again."),
  event_uri: z.string().max(200).regex(EVENT_URI_PATTERN, "Please refresh the page and try again."),
  invitee_uri: z.string().max(300).regex(INVITEE_URI_PATTERN, "Please refresh the page and try again.")
});
