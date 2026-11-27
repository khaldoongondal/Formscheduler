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
  // Counted only for valid signup forms, right before an account is created.
  signup: { limit: 5, windowSeconds: 3600 },
  // "Send again" on the check-email page has its own budget.
  "signup-resend": { limit: 5, windowSeconds: 3600 },
  "password-reset": { limit: 5, windowSeconds: 3600 }
} as const;

export type IpLimitScope = keyof typeof IP_LIMITS;

/**
 * Per UTC day. Blocked attempts never add to these counters, and each IP has
 * its own smaller daily budget per form (the *PerIpPerForm values), so one
 * visitor cannot use up a form's or a tenant's allowance. The form and tenant
 * caps sit well above realistic volume; they only stop runaway abuse.
 */
export const DAILY_CAPS = {
  leadSessionsPerIpPerForm: 30,
  leadSessionsPerForm: 2000,
  leadSessionsPerTenant: 10000,
  analyticsPerIpPerForm: 2000,
  analyticsPerForm: 50000,
  analyticsPerTenant: 200000,
  reportsPerIpPerForm: 3,
  reportsPerForm: 50
} as const;

/**
 * Per-address send cooldowns: at most `limit` emails per window to one
 * address, whoever asks. A short cooldown instead of an hourly lockout, so
 * nobody can block a real user's reset or verification email for long.
 */
export const EMAIL_SEND_COOLDOWNS = {
  "signup-email": { limit: 1, windowSeconds: 180 },
  "password-reset-email": { limit: 1, windowSeconds: 180 }
} as const;

export type EmailSendScope = keyof typeof EMAIL_SEND_COOLDOWNS;

/** Largest JSON body accepted by /api/analytics, in bytes. */
export const ANALYTICS_MAX_BODY_BYTES = 16384;
