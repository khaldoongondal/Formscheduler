/** Every numeric rate limit and daily cap lives here. Pure module. */

export const IP_LIMITS = {
  analytics: { limit: 120, windowSeconds: 60 },
  bookings: { limit: 5, windowSeconds: 60 },
  "booking-slots": { limit: 30, windowSeconds: 60 },
  "lead-sessions": { limit: 10, windowSeconds: 60 },
  "lead-answers": { limit: 60, windowSeconds: 60 },
  "lead-abandon": { limit: 20, windowSeconds: 60 },
  "embed-snippets": { limit: 30, windowSeconds: 60 },
  provision: { limit: 10, windowSeconds: 60 },
  "form-reports": { limit: 5, windowSeconds: 3600 },
  login: { limit: 10, windowSeconds: 300 },
  signup: { limit: 5, windowSeconds: 3600 }, // used by P3
  "password-reset": { limit: 5, windowSeconds: 3600 } // used by P3
} as const;

export type IpLimitScope = keyof typeof IP_LIMITS;

/** Per UTC day. */
export const DAILY_CAPS = {
  leadSessionsPerForm: 300,
  leadSessionsPerTenant: 1000,
  analyticsPerForm: 10000,
  analyticsPerTenant: 30000,
  reportsPerForm: 50
} as const;

/** Largest JSON body accepted by /api/analytics, in bytes. */
export const ANALYTICS_MAX_BODY_BYTES = 16384;
