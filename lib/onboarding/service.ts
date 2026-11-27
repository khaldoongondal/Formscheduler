/**
 * Onboarding state loader and markers (Sprint 4 P2, decisions D15, D16, D19).
 * Every read is scoped to the caller's tenant and degrades to "not done" on
 * failure (for example before migration 0033), so the admin pages never break
 * because of the checklist.
 */
import { unstable_noStore as noStore } from "next/cache";
import { listConnections, type ConnectionSummary } from "@/lib/connections/service";
import { welcomeSetupState } from "@/lib/connections/setup-state";
import { listGhlConnections } from "@/lib/ghl/connections";
import {
  accountAgeDays,
  deriveChecklist,
  formFactsForChecklist,
  setupCallMoment,
  type Checklist,
  type SetupCallMoment
} from "@/lib/onboarding/checklist";
import { createServiceClient } from "@/lib/supabase/server";

export type OnboardingField = "preview_opened_at" | "embed_copied_at" | "checklist_hidden_at" | "setup_call_dismissed_at";

export type OnboardingState = {
  checklist: Checklist;
  hidden: boolean;
  setupCall: { moment: SetupCallMoment | null; url: string | null };
};

type OnboardingRow = {
  preview_opened_at: string | null;
  embed_copied_at: string | null;
  checklist_hidden_at: string | null;
  setup_call_dismissed_at: string | null;
};

type FormRow = { id: string; is_published: boolean; frozen_at?: string | null; meta_pixel_id?: string | null; created_at: string };

/** The free setup-call link (FORMBOOK_SETUP_CALL_URL), https or http as before; null when unset or invalid. */
export function getSetupCallUrl(): string | null {
  const raw = process.env.FORMBOOK_SETUP_CALL_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function logFailure(scope: string, error: unknown) {
  console.error(`[onboarding] ${scope} failed`, error instanceof Error ? error.message : "unknown error");
}

async function loadForms(tenantId: string): Promise<FormRow[]> {
  const supabase = createServiceClient();
  // Newest columns first; a missing column (42703) steps down one select.
  const selects = [
    "id,is_published,frozen_at,meta_pixel_id,created_at",
    "id,is_published,meta_pixel_id,created_at",
    "id,is_published,created_at"
  ];
  for (const select of selects) {
    const { data, error } = await supabase
      .from("funnels")
      .select(select)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true });
    if (!error) return (data ?? []) as unknown as FormRow[];
    if (error.code !== "42703") throw new Error(error.message);
  }
  return [];
}

async function loadStartedSplitTest(tenantId: string): Promise<boolean> {
  const supabase = createServiceClient();
  const { count, error } = await supabase
    .from("split_tests")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .in("status", ["running", "ended"]);
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

async function loadOnboardingRow(tenantId: string): Promise<OnboardingRow | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("tenant_onboarding")
    .select("preview_opened_at,embed_copied_at,checklist_hidden_at,setup_call_dismissed_at")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as OnboardingRow | null) ?? null;
}

async function loadTenantCreatedAt(tenantId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("tenants").select("created_at").eq("id", tenantId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.created_at as string | undefined) ?? null;
}

function settle<T>(promise: Promise<T>, fallback: T, scope: string): Promise<T> {
  return promise.catch((error: unknown) => {
    logFailure(scope, error);
    return fallback;
  });
}

export async function getOnboardingState(tenantId: string): Promise<OnboardingState> {
  noStore();
  const [forms, ghlConnections, connections, startedSplitTest, row, createdAt] = await Promise.all([
    settle(loadForms(tenantId), [] as FormRow[], "forms read"),
    settle(listGhlConnections(tenantId) as Promise<Array<{ is_active: boolean }>>, [] as Array<{ is_active: boolean }>, "GoHighLevel connections read"),
    // Empty before migration 0029.
    settle(listConnections(tenantId), [] as ConnectionSummary[], "connections read"),
    settle(loadStartedSplitTest(tenantId), false, "split tests read"),
    // Missing table (before 0033) or row means nothing marked yet.
    settle(loadOnboardingRow(tenantId), null as OnboardingRow | null, "onboarding row read"),
    settle(loadTenantCreatedAt(tenantId), null as string | null, "tenant read")
  ]);

  const setup = welcomeSetupState(ghlConnections, connections);
  const facts = formFactsForChecklist(forms);
  const checklist = deriveChecklist({
    calendarDone: setup.calendarDone,
    crmDone: setup.crmDone,
    ...facts,
    previewOpened: Boolean(row?.preview_opened_at),
    embedCopied: Boolean(row?.embed_copied_at),
    hasStartedSplitTest: startedSplitTest
  });
  const url = getSetupCallUrl();
  const moment = setupCallMoment({
    urlConfigured: Boolean(url),
    dismissed: Boolean(row?.setup_call_dismissed_at),
    checklistComplete: checklist.complete,
    hasActiveForm: forms.some((form) => form.is_published),
    accountAgeDays: accountAgeDays(createdAt, Date.now())
  });

  return { checklist, hidden: Boolean(row?.checklist_hidden_at), setupCall: { moment, url } };
}

/** Marks a step or dismissal once (clear only for the hidden checklist). Never throws. */
export async function markOnboarding(tenantId: string, field: OnboardingField, clear = false): Promise<void> {
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.rpc("mark_tenant_onboarding", { p_tenant_id: tenantId, p_field: field, p_clear: clear });
    if (error) logFailure(`mark ${field}`, error);
  } catch (error) {
    logFailure(`mark ${field}`, error);
  }
}
