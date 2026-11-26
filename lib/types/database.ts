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
  occurred_at: string;
  created_at: string;
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
    };
    Views: Record<string, never>;
    Functions: {
      rate_limit_hit: {
        Args: { p_bucket_key: string; p_window_seconds: number };
        Returns: number;
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
