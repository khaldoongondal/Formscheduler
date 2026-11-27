export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type LeadSessionStatus =
  | "started"
  | "potential"
  | "qualified"
  | "slots_shown"
  | "booked"
  | "disqualified"
  | "abandoned"
  | "error";

export type QuestionType =
  | "text"
  | "email"
  | "phone"
  | "url"
  | "number"
  | "single_select"
  | "multi_select";

export type AnalyticsEventType =
  | "page_view"
  | "step_view"
  | "form_start"
  | "funnel_start"
  | "lead_captured"
  | "qualified_lead"
  | "disqualified_lead"
  | "slots_shown"
  | "appointment_booked"
  | "booking_error"
  | "abandoned";

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: "free" | "scaling" | "suspended";
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  business_name: string | null;
  website: string | null;
  signup_source: "legacy" | "provisioned" | "self_serve";
  /** Owner switch for the "Powered by FormBook" badge (free plan only). */
  badge_enabled: boolean;
  plan_before_suspension: "free" | "scaling" | null;
  suspended_at: string | null;
  suspension_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface TenantMember {
  id: string;
  tenant_id: string;
  user_id: string;
    role: "owner" | "admin" | "member";
  created_at: string;
}

export interface GhlConnection {
  id: string;
  tenant_id: string;
  name: string;
  location_id: string;
  calendar_id: string | null;
  private_token_ciphertext: string | null;
  token_last_four: string | null;
  auth_type: "token" | "oauth";
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
  token_expires_at: string | null;
  company_id: string | null;
  api_base_url: string;
  api_version: string;
  /** Migration 0024; undefined before it is applied. */
  use_gondal_attribution_fields?: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Funnel {
  id: string;
  tenant_id: string;
  ghl_connection_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  is_published: boolean;
  logo_url: string | null;
  logo_alignment: "left" | "center";
  show_intro_headline: boolean;
  show_intro_description: boolean;
  primary_color: string;
  accent_color: string;
  button_color: string;
  border_radius: number;
  phone_pulse_enabled: boolean;
  slot_duration_minutes: number;
  availability_window_days: number;
  calendar_id: string | null;
  appointment_title: string;
  redirect_url: string | null;
  opt_in_pipeline_id: string | null;
  opt_in_pipeline_stage_id: string | null;
  booked_pipeline_id: string | null;
  booked_pipeline_stage_id: string | null;
  disqualified_pipeline_id: string | null;
  disqualified_pipeline_stage_id: string | null;
  opportunity_name_template: string;
  qualification_rule: Json;
  embed_settings: Json;
  popup_settings: Json;
  routing_rules: Json;
  scoring_rules: Json;
  disqualification_rules: Json;
  /** Set by the platform owner (takedown). A taken-down form cannot be active. */
  taken_down_at: string | null;
  taken_down_reason: string | null;
  /** Meta pixel this form sends events to (migration 0027). */
  meta_pixel_id?: string | null;
  /** The customer's confirmation that they have consent to send lead data to Meta. */
  meta_consent_confirmed_at?: string | null;
  meta_consent_confirmed_by?: string | null;
  /** Show a consent checkbox on the form; unticked leads are never sent. */
  meta_consent_checkbox_enabled?: boolean;
  meta_consent_checkbox_label?: string | null;
  /** Set on demo forms made by scripts/seed-demo.mjs (migration 0028). */
  demo_seed_batch?: string | null;
  /**
   * Calendar and CRM choice (migration 0029). Undefined before it is applied,
   * which means GoHighLevel for both roles. The GoHighLevel connection for
   * either role stays in ghl_connection_id.
   */
  calendar_provider?: "ghl" | "google_calendar" | "calcom" | "calendly";
  calendar_connection_id?: string | null;
  crm_provider?: "ghl" | "hubspot" | "webhook";
  crm_connection_id?: string | null;
  calendar_settings?: Json;
  crm_settings?: Json;
  created_at: string;
  updated_at: string;
}

export interface Question {
  id: string;
  tenant_id: string;
  funnel_id: string;
  stable_key: string;
  label: string;
  help_text: string | null;
  question_type: QuestionType;
  placeholder: string | null;
  is_required: boolean;
  display_order: number;
  ghl_field_key: string | null;
  ghl_custom_field_id: string | null;
  ghl_custom_field_key: string | null;
  conditional_logic: Json;
  branching_logic: Json;
  validation: Json;
  created_at: string;
  updated_at: string;
}

export interface QuestionOption {
  id: string;
  tenant_id: string;
  question_id: string;
  stable_key: string;
  label: string;
  value: string;
  display_order: number;
  is_disqualifying: boolean;
  created_at: string;
  updated_at: string;
}

export interface LeadSession {
  id: string;
  tenant_id: string;
  funnel_id: string;
  status: LeadSessionStatus;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  visitor_id: string | null;
  ghl_connection_id: string | null;
  ghl_contact_id: string | null;
  ghl_opportunity_id: string | null;
  source_url: string | null;
  referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  user_agent: string | null;
  ip_address: string | null;
  metadata: Json;
  /** Running split test this lead came through (migration 0025). */
  split_test_id?: string | null;
  /** The lead's answer to the Meta consent checkbox; null when not asked (migration 0027). */
  meta_consent?: boolean | null;
  /** Set when the tenant fired this lead's held Meta events (hold mode). */
  meta_released_at?: string | null;
  meta_released_by?: string | null;
  /**
   * Opaque reference for this lead's Meta event ids (migration 0027). It is
   * posted to the embedding page, so it must never be the session id, which
   * authorises the public lead APIs.
   */
  meta_event_ref?: string | null;
  /**
   * Opaque lead id sent to calendars, CRMs and webhooks (migration 0029).
   * Never the session id, which authorises the public lead APIs.
   */
  external_ref?: string;
  /** Contact and deal ids in a non-GoHighLevel CRM (migration 0029). */
  crm_contact_id?: string | null;
  crm_deal_id?: string | null;
  started_at: string;
  qualified_at: string | null;
  slots_shown_at: string | null;
  booked_at: string | null;
  disqualified_at: string | null;
  abandoned_at: string | null;
  errored_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadStatusHistory {
  id: string;
  tenant_id: string;
  lead_session_id: string;
  from_status: LeadSessionStatus | null;
  to_status: LeadSessionStatus;
  reason: string | null;
  metadata: Json;
  created_at: string;
}

export interface LeadAnswer {
  id: string;
  tenant_id: string;
  lead_session_id: string;
  question_id: string;
  question_stable_key: string;
  answer_text: string | null;
  answer_number: number | null;
  answer_options: string[];
  raw_value: Json;
  created_at: string;
  updated_at: string;
}

export interface BookingAttempt {
  id: string;
  tenant_id: string;
  funnel_id: string;
  lead_session_id: string;
  ghl_contact_id: string | null;
  ghl_opportunity_id: string | null;
  ghl_calendar_id: string | null;
  ghl_appointment_id: string | null;
  slot_start: string | null;
  slot_end: string | null;
  timezone: string | null;
  status: string;
  error_code: string | null;
  error_message: string | null;
  request_payload: Json;
  response_payload: Json;
  /** Migration 0029. Null on GoHighLevel rows written before it. */
  provider?: "ghl" | "google_calendar" | "calcom" | "calendly" | null;
  calendar_connection_id?: string | null;
  external_booking_id?: string | null;
  meeting_url?: string | null;
  created_at: string;
  updated_at: string;
}

export type ConnectionProvider = "google_calendar" | "calcom" | "calendly" | "hubspot" | "webhook";
export type ConnectionStatusValue = "connected" | "needs_attention" | "disabled";

/**
 * A calendar or CRM connection other than GoHighLevel (migration 0029).
 * Holds ciphertext: server-only. UI code gets a ConnectionSummary instead.
 */
export interface Connection {
  id: string;
  tenant_id: string;
  provider: ConnectionProvider;
  name: string;
  status: ConnectionStatusValue;
  status_message: string | null;
  account_label: string | null;
  external_account_id: string | null;
  secret_ciphertext: string | null;
  secret_last_four: string | null;
  refresh_token_ciphertext: string | null;
  token_expires_at: string | null;
  signing_secret_ciphertext: string | null;
  signing_secret_last_four: string | null;
  endpoint_url: string | null;
  settings: Json;
  availability: Json | null;
  availability_confirmed_at: string | null;
  last_checked_at: string | null;
  last_check_ok: boolean | null;
  last_check_summary: string | null;
  created_at: string;
  updated_at: string;
}

export type CrmDeliveryStatus = "pending" | "sent" | "failed" | "skipped" | "cancelled";
export type CrmDeliveryEventType = "lead.captured" | "lead.qualified" | "lead.disqualified" | "lead.booked" | "test.ping";

/** One CRM event for one target (migration 0031): queue row and tenant delivery log. */
export interface CrmEventDelivery {
  id: string;
  tenant_id: string;
  connection_id: string | null;
  ghl_connection_id: string | null;
  provider: "ghl" | "hubspot" | "webhook";
  funnel_id: string | null;
  lead_session_id: string | null;
  event_type: CrmDeliveryEventType;
  event_id: string;
  /** The frozen FormBook event; wiped 30 days after the row settles. */
  payload: Json | null;
  status: CrmDeliveryStatus;
  status_reason: string | null;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  response_status: number | null;
  response_summary: string | null;
  last_error: string | null;
  sent_at: string | null;
  settled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnalyticsEvent {
  id: string;
  tenant_id: string;
  funnel_id: string | null;
  lead_session_id: string | null;
  visitor_id: string | null;
  event_type: AnalyticsEventType;
  source: string;
  source_url: string | null;
  user_agent: string | null;
  metadata: Json;
  /** Running split test this event belongs to (migration 0025). */
  split_test_id?: string | null;
  occurred_at: string;
  created_at: string;
}

export type SplitTestStatus = "draft" | "running" | "ended";

export interface SplitTest {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  status: SplitTestStatus;
  winner_funnel_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  /** Set on demo tests made by scripts/seed-demo.mjs (migration 0028). */
  demo_seed_batch?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SplitTestMember {
  test_id: string;
  funnel_id: string;
  tenant_id: string;
  position: number;
  created_at: string;
}

export interface AdSpendEntry {
  id: string;
  tenant_id: string;
  funnel_id: string;
  /** Set for split test spend (covers the whole test); null for single-form spend. */
  split_test_id: string | null;
  period_start: string | null;
  period_end: string | null;
  amount_cents: number;
  currency: "USD" | "CAD" | "EUR" | "GBP" | "AUD";
  note: string | null;
  created_at: string;
  updated_at: string;
}

export type MetaSendingMode = "automatic" | "hold";

export interface MetaPixel {
  id: string;
  tenant_id: string;
  name: string;
  dataset_id: string;
  /** AES-GCM envelope (encryptSecret). Never selected for display. */
  access_token_ciphertext: string;
  token_last_four: string | null;
  test_event_code: string | null;
  sending_mode: MetaSendingMode;
  send_form_view: boolean;
  send_form_start: boolean;
  send_lead: boolean;
  send_qualified_lead: boolean;
  send_disqualified_lead: boolean;
  send_booked_call: boolean;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_summary: string | null;
  created_at: string;
  updated_at: string;
}

export type MetaDeliveryEventKey =
  | "form_view"
  | "form_start"
  | "lead"
  | "qualified_lead"
  | "disqualified_lead"
  | "booked_call"
  | "test_event";

export type MetaDeliveryStatus =
  | "awaiting_consent"
  | "held"
  | "pending"
  | "sent"
  | "failed"
  | "skipped"
  | "expired"
  | "cancelled";

export interface MetaEventDelivery {
  id: string;
  tenant_id: string;
  pixel_id: string;
  funnel_id: string | null;
  lead_session_id: string | null;
  split_test_id: string | null;
  visitor_id: string | null;
  event_key: MetaDeliveryEventKey;
  event_name: string;
  event_id: string;
  event_time: string;
  /** The frozen Meta event with user data already hashed; wiped when settled and old. */
  payload: Json | null;
  match_keys: string[];
  status: MetaDeliveryStatus;
  status_reason: string | null;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  meta_response: Json | null;
  last_error: string | null;
  test_event_code_used: string | null;
  fired_by: string | null;
  fired_at: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

/** One row of meta_match_key_coverage (migration 0028). */
export interface MetaMatchKeyCoverageRow {
  event_key: string;
  events: number;
  with_em: number;
  with_ph: number;
  with_fn: number;
  with_ln: number;
  with_ip: number;
  with_ua: number;
  with_fbp: number;
  with_fbc: number;
  with_external_id: number;
  with_location: number;
}

/** One row of meta_match_key_coverage (migration 0028). */
export interface MetaMatchKeyCoverageRow {
  event_key: string;
  events: number;
  with_em: number;
  with_ph: number;
  with_fn: number;
  with_ln: number;
  with_ip: number;
  with_ua: number;
  with_fbp: number;
  with_fbc: number;
  with_external_id: number;
  with_location: number;
}

export interface PlanLimitsRow {
  plan: "free" | "scaling" | "suspended";
  display_name: string;
  monthly_price_cents: number;
  max_active_forms: number;
  max_draft_forms: number;
  max_pixels: number;
  updated_at: string;
}

export interface RateLimitCounter {
  bucket_key: string;
  hits: number;
  expires_at: string;
}

export type FormReportReason = "phishing" | "spam" | "impersonation" | "illegal" | "other";
export type FormReportStatus = "open" | "actioned" | "dismissed";

export interface FormReport {
  id: string;
  funnel_id: string | null;
  tenant_id: string | null;
  funnel_slug: string;
  reason: FormReportReason;
  details: string | null;
  reporter_email: string | null;
  reporter_ip_hash: string | null;
  status: FormReportStatus;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface SignupRequest {
  user_id: string;
  email: string;
  full_name: string;
  phone: string;
  business_name: string;
  website: string;
  plan: "free" | "scaling";
  tenant_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export type OwnerAuditAction =
  | "set_plan"
  | "set_badge"
  | "suspend"
  | "restore"
  | "take_down_form"
  | "restore_form"
  | "resolve_report";

export interface OwnerAuditLog {
  id: string;
  actor_email: string;
  action: OwnerAuditAction;
  target_type: "tenant" | "funnel" | "report";
  target_id: string;
  details: Json;
  created_at: string;
}

export interface OwnerClientListRow {
  tenant_id: string;
  tenant_name: string;
  business_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  owner_email: string | null;
  plan: string;
  badge_enabled: boolean;
  active_forms: number;
  draft_forms: number;
  leads_30d: number;
  open_reports: number;
  last_activity_at: string | null;
  created_at: string;
}

export interface Database {
  public: {
    Tables: {
      tenants: Table<Tenant>;
      tenant_members: Table<TenantMember>;
      ghl_connections: Table<GhlConnection>;
      funnels: Table<Funnel>;
      questions: Table<Question>;
      question_options: Table<QuestionOption>;
      lead_sessions: Table<LeadSession>;
      lead_status_history: Table<LeadStatusHistory>;
      lead_answers: Table<LeadAnswer>;
      booking_attempts: Table<BookingAttempt>;
      analytics_events: Table<AnalyticsEvent>;
      plan_limits: Table<PlanLimitsRow>;
      rate_limit_counters: Table<RateLimitCounter>;
      form_reports: Table<FormReport>;
      signup_requests: Table<SignupRequest>;
      owner_audit_log: Table<OwnerAuditLog>;
      split_tests: Table<SplitTest>;
      split_test_members: Table<SplitTestMember>;
      ad_spend_entries: Table<AdSpendEntry>;
      meta_pixels: Table<MetaPixel>;
      meta_event_deliveries: Table<MetaEventDelivery>;
      connections: Table<Connection>;
      crm_event_deliveries: Table<CrmEventDelivery>;
    };
    Views: Record<string, never>;
    Functions: {
      rate_limit_hit: {
        Args: { p_bucket_key: string; p_window_seconds: number };
        Returns: number;
      };
      rate_limit_hit_capped: {
        Args: { p_bucket_key: string; p_window_seconds: number; p_limit: number };
        Returns: boolean;
      };
      rate_limit_release: {
        Args: { p_bucket_key: string };
        Returns: undefined;
      };
      get_auth_user_id_by_email: {
        Args: { p_email: string };
        Returns: string | null;
      };
      is_auth_user_confirmed: {
        Args: { p_user_id: string };
        Returns: boolean;
      };
      complete_signup: {
        Args: { p_user_id: string };
        Returns: string | null;
      };
      owner_list_clients: {
        Args: Record<string, never>;
        Returns: OwnerClientListRow[];
      };
      meta_link_visitor_events: {
        Args: {
          p_tenant_id: string;
          p_funnel_id: string;
          p_visitor_id: string;
          p_lead_session_id: string;
          p_consent: "granted" | "declined" | "not_asked";
          p_hold: boolean;
        };
        Returns: number;
      };
      claim_meta_deliveries: {
        Args: { p_owner: string; p_limit?: number; p_lease_seconds?: number };
        Returns: MetaEventDelivery[];
      };
      claim_meta_deliveries_by_ids: {
        Args: { p_ids: string[]; p_owner: string; p_lease_seconds?: number };
        Returns: MetaEventDelivery[];
      };
      settle_meta_delivery: {
        Args: {
          p_id: string;
          p_owner: string;
          p_outcome: "sent" | "retry" | "failed" | "skipped" | "deferred";
          p_error?: string | null;
          p_reason?: string | null;
          p_response?: Json | null;
        };
        Returns: boolean;
      };
      release_meta_delivery: {
        Args: { p_id: string; p_owner: string };
        Returns: boolean;
      };
      meta_housekeeping: {
        Args: Record<string, never>;
        Returns: Json;
      };
      meta_release_held: {
        Args: { p_tenant_id: string; p_pixel_id: string | null; p_lead_session_id: string | null; p_by: string };
        Returns: string[];
      };
      meta_match_key_coverage: {
        Args: { p_tenant_id: string; p_pixel_id: string; p_from: string; p_to: string };
        Returns: MetaMatchKeyCoverageRow[];
      };
      claim_crm_deliveries: {
        Args: { p_owner: string; p_limit?: number; p_lease_seconds?: number };
        Returns: CrmEventDelivery[];
      };
      claim_crm_deliveries_by_ids: {
        Args: { p_ids: string[]; p_owner: string; p_lease_seconds?: number };
        Returns: CrmEventDelivery[];
      };
      settle_crm_delivery: {
        Args: {
          p_id: string;
          p_owner: string;
          p_outcome: "sent" | "retry" | "failed" | "skipped";
          p_status?: number | null;
          p_summary?: string | null;
          p_error?: string | null;
          p_reason?: string | null;
        };
        Returns: boolean;
      };
      release_crm_delivery: {
        Args: { p_id: string; p_owner: string };
        Returns: boolean;
      };
      retry_crm_delivery: {
        Args: { p_id: string; p_tenant_id: string };
        Returns: boolean;
      };
      crm_housekeeping: {
        Args: Record<string, never>;
        Returns: Json;
      };
      split_test_replace_members: {
        Args: { p_tenant_id: string; p_test_id: string; p_funnel_ids: string[] };
        Returns: undefined;
      };
    };
    Enums: {
      lead_session_status: LeadSessionStatus;
      question_type: QuestionType;
      analytics_event_type: AnalyticsEventType;
    };
    CompositeTypes: Record<string, never>;
  };
}

type Table<Row> = {
  Row: Row & Record<string, unknown>;
  Insert: Partial<Row> & Record<string, unknown>;
  Update: Partial<Row> & Record<string, unknown>;
  Relationships: [];
};
