import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Brush,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Code2,
  Copy,
  ExternalLink,
  ListChecks,
  Plug,
  Settings
} from "lucide-react";
import {
  deleteFunnelAction,
  deleteQuestionAction,
  deleteQuestionOptionAction,
  duplicateFunnelAction,
  moveIntakeFlowItemAction,
  updateAnalyticsTargetCountriesAction,
  updateContactFieldsAction,
  updateFunnelAction,
  uploadLogoAction,
  upsertQuestionAction,
  upsertQuestionOptionAction
} from "@/app/(admin)/admin/funnels/actions";
import {
  getFunnelAnalytics,
  resolveAnalyticsDateRange,
  type AnalyticsDateRange,
  type FunnelDropOffStepRow,
  type SplitVariantPerformanceRow
} from "@/lib/analytics/service";
import {
  analyticsCountryOptions,
  analyticsTrafficSourceOptions,
  resolveAnalyticsTargetCountryCodes,
  resolveAnalyticsTrafficSources
} from "@/lib/analytics/country-filter";
import { getAdminTenantId } from "@/lib/auth/tenant";
import { getMissingSupabaseAdminEnv } from "@/lib/env";
import { buildIframeSnippet, buildPopupSnippet, buildSplitTestIframeSnippet } from "@/lib/embed/snippets";
import {
  contactFieldOptions,
  intakeFlowItemToKey,
  resolveContactFieldConfig,
  resolveDisabledQuestionIds,
  resolveIntakeFlowEditorOrder
} from "@/lib/funnels/contact-fields";
import {
  numberDisqualificationOperators,
  resolveQuestionDisqualificationRule,
  stringDisqualificationOperators,
  supportsQuestionDisqualificationRule
} from "@/lib/funnels/disqualification";
import { getFunnelById } from "@/lib/funnels/service";
import { listGhlConnections } from "@/lib/ghl/connections";
import type { Json, QuestionType } from "@/lib/types/database";
import { SaveSubmitButton } from "@/components/admin/save-submit-button";
import { SetupRequired } from "@/components/setup/setup-required";
import { CopySnippetButton } from "@/components/admin/copy-snippet-button";
import { LogoDropInput } from "@/components/admin/logo-drop-input";
import { ConfirmDeleteButton } from "@/components/admin/confirm-delete-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const inputClass =
  "flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export const dynamic = "force-dynamic";

const questionTypes: QuestionType[] = [
  "text",
  "email",
  "phone",
  "url",
  "number",
  "single_select",
  "multi_select"
];

export default async function FunnelDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    error?: string;
    from?: string;
    option?: string;
    preset?: string;
    question?: string;
    saved?: string;
    to?: string;
  }>;
}) {
  const { id } = await params;
  const missingEnv = getMissingSupabaseAdminEnv();
  if (missingEnv.length > 0) {
    return (
      <SetupRequired
        title="Supabase is required to edit funnels."
        description="Funnel settings, questions, analytics, and tenant permissions are database-backed. Add the Supabase environment variables before opening a funnel editor."
        missingEnv={missingEnv}
      />
    );
  }

  const [tenantId, funnel] = await Promise.all([getAdminTenantId(), getFunnelById(id)]);
  if (!funnel) notFound();
  if (funnel.tenant_id !== tenantId) notFound();

  const query = searchParams ? await searchParams : {};
  const analyticsRange = resolveAnalyticsDateRange({
    preset: query.preset,
    from: query.from,
    to: query.to
  });
  const [connections, analytics] = await Promise.all([
    listGhlConnections(funnel.tenant_id),
    getFunnelAnalytics(funnel.id, analyticsRange)
  ]);

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const bookUrl = `${baseUrl}/book/${funnel.slug}`;
  const embedUrl = `${baseUrl}/embed/${funnel.slug}`;
  const splitTestId = `ghl-${funnel.slug}`;
  const controlSplitIframe = buildSplitTestIframeSnippet(embedUrl, {
    splitTestId,
    splitVariant: "control"
  });
  const variationSplitIframe = buildSplitTestIframeSnippet(embedUrl, {
    splitTestId,
    splitVariant: "variation"
  });
  const selectedConnection = connections.find((connection) => connection.id === funnel.ghl_connection_id);
  const actionError = typeof query.error === "string" ? query.error : null;
  const actionSuccess = actionSuccessMessage(query.saved);
  const savedQuestionId = query.saved === "question" || query.saved === "question-order" ? query.question : null;
  const savedOptionId = query.saved === "option" ? query.option : null;
  const savedOptionQuestionId = query.saved === "option" || query.saved === "option-deleted" ? query.question : null;
  const highlightedQuestionId = savedQuestionId ?? savedOptionQuestionId;
  const settingsSaved = query.saved === "funnel" || query.saved === "created" || query.saved === "duplicated";
  const intakeFlowSaved = query.saved === "intake-flow" || query.saved === "contact-fields";
  const analyticsFiltersSaved = query.saved === "analytics-filters";
  const targetCountryCodes = resolveAnalyticsTargetCountryCodes(funnel.qualification_rule);
  const targetTrafficSources = resolveAnalyticsTrafficSources(funnel.qualification_rule);
  const contactFieldConfig = resolveContactFieldConfig(funnel.qualification_rule);
  const contactFields = contactFieldConfig.settings;
  const questionIds = funnel.questions.map((question) => question.id);
  const disabledQuestionIds = resolveDisabledQuestionIds(funnel.qualification_rule, questionIds);
  const intakeFlowItems = resolveIntakeFlowEditorOrder(
    funnel.qualification_rule,
    questionIds
  );
  const orderedQuestions = intakeFlowItems
    .filter((item) => item.type === "question")
    .map((item) => funnel.questions.find((question) => question.id === item.id))
    .filter((question): question is (typeof funnel.questions)[number] => Boolean(question));

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-3 mb-3">
            <Link href="/admin/funnels">
              <ArrowLeft className="h-4 w-4" />
              All funnels
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{funnel.name}</h1>
            <StatusBadge published={funnel.is_published} />
          </div>
          <p className="mt-2 text-sm text-slate-600">/{funnel.slug}</p>
          {funnel.description ? (
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">{funnel.description}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={bookUrl} target="_blank">
              <ExternalLink className="h-4 w-4" />
              Preview
            </Link>
          </Button>
          <form action={duplicateFunnelAction}>
            <input type="hidden" name="id" value={funnel.id} />
            <Button type="submit" variant="outline">
              <Copy className="h-4 w-4" />
              Duplicate
            </Button>
          </form>
        </div>
      </div>

      {actionError ? <ActionError message={actionError} /> : null}
      {actionSuccess ? <ActionSuccess message={actionSuccess} /> : null}

      <Card id="performance" className="scroll-mt-24 overflow-hidden">
        <CardHeader className="border-b border-slate-100 p-5">
          <div className="min-w-0">
            <SectionTitle icon={<BarChart3 className="h-5 w-5" />} title="Performance" />
            <CardDescription className="mt-2">
              Filtered funnel results for clean split-test decisions.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 p-5">
          <AnalyticsControls
            funnelId={funnel.id}
            filtersSaved={analyticsFiltersSaved}
            range={analyticsRange}
            selectedCountryCodes={targetCountryCodes}
            selectedTrafficSources={targetTrafficSources}
          />
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Unique visitors"
              value={analytics?.uniqueVisitors ?? 0}
              helper="Filtered traffic"
            />
            <Metric
              label="Leads / opt-ins"
              value={analytics?.optInCount ?? 0}
              helper="Reached saved lead status"
            />
            <Metric
              label="Calls booked"
              value={analytics?.callsBookedCount ?? 0}
              helper="Booked in GHL"
            />
            <Metric
              label="Visitor to booked"
              value={formatRate(analytics?.visitorToBookedRate ?? 0)}
              helper="End-to-end conversion"
            />
          </section>
          <ConversionPath
            leadToBookedRate={analytics?.callBookingRate ?? 0}
            visitorToBookedRate={analytics?.visitorToBookedRate ?? 0}
            visitorToLeadRate={analytics?.optInRate ?? 0}
          />
          <DropOffTable rows={analytics?.dropOffSteps ?? []} />
          <SplitTestPerformanceTable rows={analytics?.splitVariants ?? []} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionTitle icon={<CalendarClock className="h-5 w-5" />} title="Current handoff" />
          <CardDescription>This is what the funnel is using right now for GHL account, calendar, and pipeline routing.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-6">
          <SummaryRow label="GHL connection" value={selectedConnection?.name ?? "Not connected"} />
          <SummaryRow label="Calendar" value={funnel.calendar_id ?? selectedConnection?.calendar_id ?? "Not set"} />
          <SummaryRow label="Availability" value={`${funnel.availability_window_days ?? 14} days`} />
          <SummaryRow label="Call not booked stage" value={funnel.opt_in_pipeline_stage_id ?? "Not set"} />
          <SummaryRow label="Call booked stage" value={funnel.booked_pipeline_stage_id ?? "Not set"} />
          <SummaryRow label="Disqualified stage" value={funnel.disqualified_pipeline_stage_id ?? "Not set"} />
        </CardContent>
      </Card>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SettingsJump href="#settings" label="Funnel settings" description="Public copy, booking, GHL, routing, and theme." />
        <SettingsJump href="#questions" label="Question flow" description="Contact fields, qualification questions, and answers." />
        <SettingsJump href="#logo" label="Logo" description="Drop in an optional first-screen logo file." />
        <SettingsJump href="#embed-links" label="Embed and links" description="Full-page, iframe, and popup snippets." />
      </section>

      <section className="space-y-6">
          <Card id="settings" className="overflow-hidden">
            <CardHeader className="border-b border-slate-100 bg-slate-50/70">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <SectionTitle icon={<Settings className="h-5 w-5" />} title="Funnel settings" />
                  <CardDescription className="mt-2">
                    These settings save together. Use the groups below to know exactly what each control affects.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {settingsSaved ? <SavedBadge label="Funnel settings saved" /> : null}
                  <Button asChild variant="outline">
                    <Link href={bookUrl} target="_blank">
                      <ExternalLink className="h-4 w-4" />
                      Preview
                    </Link>
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <form action={updateFunnelAction} className="space-y-5">
                <input type="hidden" name="id" value={funnel.id} />

                <SettingsGroup
                  icon={<Settings className="h-4 w-4" />}
                  title="1. Public page copy"
                  description="Controls the top of the public funnel and whether visitors can access it."
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Public title" name="name" defaultValue={funnel.name} required />
                    <Field label="URL slug" name="slug" defaultValue={funnel.slug} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">First-screen paragraph</Label>
                    <Textarea id="description" name="description" defaultValue={funnel.description ?? ""} />
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <ToggleSetting
                      name="show_intro_headline"
                      defaultChecked={funnel.show_intro_headline !== false}
                      title="Show headline on first screen"
                      description="Displays the public title above the first contact fields."
                    />
                    <ToggleSetting
                      name="show_intro_description"
                      defaultChecked={funnel.show_intro_description !== false}
                      title="Show paragraph on first screen"
                      description="Displays the paragraph under the headline on the first step."
                    />
                  </div>
                  <ToggleSetting
                    name="is_published"
                    defaultChecked={funnel.is_published}
                    title="Published"
                    description="Published funnels are visible on the public /book and /embed links."
                  />
                </SettingsGroup>

                <SettingsGroup
                  icon={<CalendarClock className="h-4 w-4" />}
                  title="2. Booking result"
                  description="Controls what happens after someone chooses a time and how the appointment/opportunity appears in GHL."
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Field
                        label="Post-booking Redirect URL"
                        name="redirect_url"
                        type="url"
                        defaultValue={funnel.redirect_url ?? ""}
                      />
                      <p className="text-xs leading-5 text-slate-500">
                        Optional. The whole parent page redirects here after a successful booking.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Field
                        label="Appointment title override"
                        name="appointment_title"
                        defaultValue={funnel.appointment_title}
                        placeholder="Use GHL meeting invite title"
                      />
                      <p className="text-xs leading-5 text-slate-500">
                        Leave blank to use the meeting invite title configured on the GHL calendar.
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Field
                      label="GHL Opportunity Name Template"
                      name="opportunity_name_template"
                      defaultValue={funnel.opportunity_name_template}
                      required
                    />
                    <p className="text-xs leading-5 text-slate-500">
                      Use <code className="rounded bg-slate-100 px-1 py-0.5">{"{{lead_name}}"}</code> to show only the lead name in GHL. Other tokens: {"{{first_name}}"}, {"{{last_name}}"}, {"{{email}}"}, {"{{phone}}"}, {"{{funnel_name}}"}.
                    </p>
                  </div>
                </SettingsGroup>

                <SettingsGroup
                  icon={<Plug className="h-4 w-4" />}
                  title="3. GHL connection and calendar"
                  description="Controls which GHL account and calendar this funnel pulls availability from."
                >
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label htmlFor="ghl_connection_id">GHL Connection</Label>
                      <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs">
                        <Link href="/admin/ghl-connections">Manage connections</Link>
                      </Button>
                    </div>
                    <select
                      id="ghl_connection_id"
                      name="ghl_connection_id"
                      className={inputClass}
                      defaultValue={funnel.ghl_connection_id ?? ""}
                    >
                      <option value="">Select connection</option>
                      {connections.map((connection) => (
                        <option key={connection.id} value={connection.id}>
                          {connection.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-4 md:grid-cols-[1.5fr_0.75fr_0.75fr]">
                    <Field label="GHL Calendar ID" name="calendar_id" defaultValue={funnel.calendar_id ?? ""} />
                    <Field
                      label="Slot Minutes"
                      name="slot_duration_minutes"
                      type="number"
                      defaultValue={funnel.slot_duration_minutes}
                      min={15}
                      max={240}
                    />
                    <Field
                      label="Availability Days"
                      name="availability_window_days"
                      type="number"
                      defaultValue={funnel.availability_window_days ?? 14}
                      min={1}
                      max={60}
                    />
                  </div>
                  <p className="text-xs leading-5 text-slate-500">
                    Smaller availability windows load faster and create more urgency. This does not change the GHL calendar itself.
                  </p>
                </SettingsGroup>

                <SettingsGroup
                  icon={<ListChecks className="h-4 w-4" />}
                  title="4. Pipeline routing"
                  description="Controls where leads move in GHL when they opt in, book, or are disqualified."
                >
                  <div className="grid gap-4 lg:grid-cols-3">
                    <PipelineRoutingGroup
                      title="Call not booked"
                      description="Lead submitted the form but has not booked."
                    >
                      <Field label="Pipeline ID" name="opt_in_pipeline_id" defaultValue={funnel.opt_in_pipeline_id ?? ""} />
                      <Field label="Stage ID" name="opt_in_pipeline_stage_id" defaultValue={funnel.opt_in_pipeline_stage_id ?? ""} />
                    </PipelineRoutingGroup>
                    <PipelineRoutingGroup
                      title="Call booked"
                      description="Appointment was created in GHL."
                    >
                      <Field label="Pipeline ID" name="booked_pipeline_id" defaultValue={funnel.booked_pipeline_id ?? ""} />
                      <Field label="Stage ID" name="booked_pipeline_stage_id" defaultValue={funnel.booked_pipeline_stage_id ?? ""} />
                    </PipelineRoutingGroup>
                    <PipelineRoutingGroup
                      title="Disqualified"
                      description="A selected answer blocks calendar access."
                    >
                      <Field label="Pipeline ID" name="disqualified_pipeline_id" defaultValue={funnel.disqualified_pipeline_id ?? ""} />
                      <Field label="Stage ID" name="disqualified_pipeline_stage_id" defaultValue={funnel.disqualified_pipeline_stage_id ?? ""} />
                    </PipelineRoutingGroup>
                  </div>
                </SettingsGroup>

                <SettingsGroup
                  icon={<Brush className="h-4 w-4" />}
                  title="5. Visual theme"
                  description="Controls the public funnel colors, radius, logo URL, and first-field pulse."
                >
                  <div className="grid gap-4 md:grid-cols-[1fr_1fr_1fr_120px]">
                    <ColorField label="Primary" name="primary_color" value={funnel.primary_color} />
                    <ColorField label="Accent" name="accent_color" value={funnel.accent_color} />
                    <ColorField label="Button" name="button_color" value={funnel.button_color} />
                    <Field label="Radius" name="border_radius" type="number" defaultValue={funnel.border_radius} min={0} max={32} />
                  </div>
                  <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
                    <ToggleSetting
                      name="phone_pulse_enabled"
                      defaultChecked={funnel.phone_pulse_enabled}
                      title="Pulse first contact field"
                      description="Adds the attention-grabbing border pulse to whichever contact field appears first."
                    />
                    <div className="space-y-2">
                      <Field label="Logo URL" name="logo_url" defaultValue={funnel.logo_url ?? ""} />
                      <p className="text-xs leading-5 text-slate-500">
                        Use this for a hosted logo URL, or upload a logo in the separate Logo card below.
                      </p>
                    </div>
                  </div>
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-medium leading-none text-slate-950">Logo position</legend>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm transition hover:border-slate-300 hover:bg-slate-50">
                        <input
                          type="radio"
                          name="logo_alignment"
                          value="left"
                          defaultChecked={(funnel.logo_alignment ?? "left") === "left"}
                          className="mt-1"
                        />
                        <span>
                          <span className="block font-semibold text-slate-950">Left</span>
                          <span className="mt-1 block leading-5 text-slate-500">Aligns the logo with the form fields.</span>
                        </span>
                      </label>
                      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm transition hover:border-slate-300 hover:bg-slate-50">
                        <input
                          type="radio"
                          name="logo_alignment"
                          value="center"
                          defaultChecked={funnel.logo_alignment === "center"}
                          className="mt-1"
                        />
                        <span>
                          <span className="block font-semibold text-slate-950">Centered</span>
                          <span className="mt-1 block leading-5 text-slate-500">Centers the logo inside the first-screen header area.</span>
                        </span>
                      </label>
                    </div>
                  </fieldset>
                </SettingsGroup>

                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <SaveSubmitButton label="Save all funnel settings" />
                  {settingsSaved ? <SavedBadge label="Funnel settings saved" /> : null}
                  <p className="text-sm text-slate-500">Saves public copy, booking, GHL, routing, and theme settings together.</p>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card id="questions">
            <CardHeader>
              <SectionTitle icon={<ListChecks className="h-5 w-5" />} title="Question flow" />
              <CardDescription>Questions render in order on the public funnel. Stable keys keep future GHL field mapping clean.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <QuestionForm tenantId={funnel.tenant_id} funnelId={funnel.id} nextOrder={orderedQuestions.length + 1} />

              <div className="space-y-4">
                {orderedQuestions.map((question) => (
                  <details
                    key={question.id}
                    id={`question-${question.id}`}
                    open={highlightedQuestionId === question.id}
                    className="group rounded-lg border border-slate-200 bg-white"
                  >
                    <summary className="flex cursor-pointer list-none flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between [&::-webkit-details-marker]:hidden">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Question {question.display_order} • {question.question_type.replace("_", " ")}
                        </p>
                        <h3 className="mt-1 font-semibold text-slate-950">{question.label}</h3>
                      </div>
                      <div className="flex w-fit items-center gap-3">
                        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                          {question.is_required ? "Required" : "Optional"}
                        </span>
                        <ChevronDown className="h-4 w-4 text-slate-400 transition group-open:rotate-180" />
                      </div>
                    </summary>

                    <div className="border-t border-slate-100 p-4">
                      <form action={upsertQuestionAction} className="grid gap-3 md:grid-cols-2">
                        <input type="hidden" name="id" value={question.id} />
                        <input type="hidden" name="tenant_id" value={funnel.tenant_id} />
                        <input type="hidden" name="funnel_id" value={funnel.id} />
                        <Field label="Stable Key" name="stable_key" defaultValue={question.stable_key} required />
                        <Field label="Question Label" name="label" defaultValue={question.label} required />
                        <div className="space-y-2">
                          <Label>Type</Label>
                          <select name="question_type" className={inputClass} defaultValue={question.question_type}>
                            {questionTypes.map((type) => (
                              <option key={type} value={type}>
                                {type.replace("_", " ")}
                              </option>
                            ))}
                          </select>
                        </div>
                        <Field label="Order" name="display_order" type="number" defaultValue={question.display_order} required />
                        <Field label="Placeholder" name="placeholder" defaultValue={question.placeholder ?? ""} />
                        <Field label="GHL Field Key" name="ghl_field_key" defaultValue={question.ghl_field_key ?? ""} />
                        <Field label="GHL Custom Field ID" name="ghl_custom_field_id" defaultValue={question.ghl_custom_field_id ?? ""} />
                        <Field label="GHL Custom Field Key" name="ghl_custom_field_key" defaultValue={question.ghl_custom_field_key ?? ""} />
                        <div className="space-y-2 md:col-span-2">
                          <Label>Help Text</Label>
                          <Textarea name="help_text" defaultValue={question.help_text ?? ""} />
                        </div>
                        <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                          <input type="checkbox" name="is_required" defaultChecked={question.is_required} />
                          Required
                        </label>
                        {question.question_type !== "text" ? (
                          <QuestionDisqualificationSettings
                            questionId={question.id}
                            questionType={question.question_type}
                            validation={question.validation}
                          />
                        ) : null}
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {savedQuestionId === question.id ? <SavedBadge label="Question saved" /> : null}
                          <SaveSubmitButton label="Save question" variant="outline" />
                        </div>
                      </form>

                      {question.question_type === "single_select" || question.question_type === "multi_select" ? (
                        <div className="mt-5 border-t border-slate-100 pt-4">
                          <p className="mb-3 text-sm font-semibold text-slate-800">Answer options</p>
                          <div className="space-y-2">
                            {question.options.map((option) => (
                              <div key={option.id} className="rounded-md bg-slate-50 p-3">
                                <form action={upsertQuestionOptionAction} className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_80px_150px_auto]">
                                  <input type="hidden" name="tenant_id" value={funnel.tenant_id} />
                                  <input type="hidden" name="funnel_id" value={funnel.id} />
                                  <input type="hidden" name="question_id" value={question.id} />
                                  <Input name="stable_key" defaultValue={option.stable_key} aria-label="Stable key" />
                                  <Input name="label" defaultValue={option.label} aria-label="Label" />
                                  <Input name="value" defaultValue={option.value} aria-label="Value" />
                                  <Input name="display_order" type="number" defaultValue={option.display_order} aria-label="Order" />
                                  <label className="flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700">
                                    <input type="checkbox" name="is_disqualifying" defaultChecked={option.is_disqualifying} />
                                    Disqualifies
                                  </label>
                                  <div className="flex items-center justify-end gap-2">
                                    {savedOptionId === option.id ? <SavedBadge label="Saved" compact /> : null}
                                    <SaveSubmitButton label="Save" variant="outline" size="sm" />
                                  </div>
                                </form>
                                <form action={deleteQuestionOptionAction} data-preserve-scroll="false">
                                  <input type="hidden" name="id" value={option.id} />
                                  <input type="hidden" name="funnel_id" value={funnel.id} />
                                  <input type="hidden" name="question_id" value={question.id} />
                                  <ConfirmDeleteButton
                                    label="Delete option"
                                    title="Delete this answer option?"
                                    description={`This permanently removes "${option.label}" from this question. Leads will no longer be able to select it.`}
                                    size="sm"
                                    className="mt-2"
                                  />
                                </form>
                              </div>
                            ))}
                          </div>
                          <form action={upsertQuestionOptionAction} className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_1fr_90px_150px_auto]">
                            <input type="hidden" name="tenant_id" value={funnel.tenant_id} />
                            <input type="hidden" name="funnel_id" value={funnel.id} />
                            <input type="hidden" name="question_id" value={question.id} />
                            <Input name="stable_key" placeholder="stable_key" required />
                            <Input name="label" placeholder="Label" required />
                            <Input name="value" placeholder="value" required />
                            <Input name="display_order" type="number" placeholder="Order" defaultValue={question.options.length + 1} />
                            <label className="flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700">
                              <input type="checkbox" name="is_disqualifying" />
                              Disqualifies
                            </label>
                            <SaveSubmitButton label="Add" variant="outline" />
                          </form>
                        </div>
                      ) : null}

                      <form action={deleteQuestionAction} data-preserve-scroll="false" className="mt-4 flex justify-end border-t border-slate-100 pt-3">
                        <input type="hidden" name="id" value={question.id} />
                        <input type="hidden" name="funnel_id" value={funnel.id} />
                        <ConfirmDeleteButton
                          label="Delete question"
                          title="Delete this question?"
                          description={`This permanently removes "${question.label}" and its answer options from this funnel.`}
                          size="sm"
                        />
                      </form>
                    </div>
                  </details>
                ))}
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-950">Intake flow</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-600">
                      This is the exact order visitors see before the calendar unlocks. Uncheck a question to hide it without deleting it.
                    </p>
                  </div>
                  <form id="contact-fields-form" action={updateContactFieldsAction} className="flex shrink-0 items-center gap-2">
                    <input type="hidden" name="id" value={funnel.id} />
                    {intakeFlowSaved ? <SavedBadge label="Saved" /> : null}
                    <SaveSubmitButton label="Save intake flow" variant="outline" />
                  </form>
                </div>

                <div className="mt-4 max-w-xs space-y-2">
                  <Label htmlFor="contact_fields_per_page">Contact fields per page</Label>
                  <select
                    form="contact-fields-form"
                    id="contact_fields_per_page"
                    name="contact_fields_per_page"
                    className={inputClass}
                    defaultValue={contactFieldConfig.fieldsPerPage}
                  >
                    <option value="1">1 field per page</option>
                    <option value="2">2 fields per page</option>
                    <option value="3">3 fields per page</option>
                    <option value="4">4 fields per page</option>
                    <option value="5">Show all fields together</option>
                  </select>
                  <p className="text-xs leading-5 text-slate-500">Consecutive contact fields are grouped up to this number.</p>
                </div>

                <div className="mt-4 space-y-3">
                  {intakeFlowItems.map((item, itemIndex) => {
                    const itemKey = intakeFlowItemToKey(item);

                    if (item.type === "contact") {
                      const field = contactFieldOptions.find((option) => option.key === item.key);
                      if (!field) return null;

                      return (
                        <div
                          key={itemKey}
                          className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3 rounded-md border border-slate-200 bg-white p-4 sm:grid-cols-[1.25rem_minmax(0,1fr)_auto] sm:items-center"
                        >
                          <input form="contact-fields-form" type="hidden" name="intake_flow_order" value={itemKey} />
                          <input form="contact-fields-form" type="hidden" name="contact_field_order" value={field.key} />
                          <input
                            form="contact-fields-form"
                            type="checkbox"
                            id={`contact_field_${field.key}`}
                            name={`contact_field_${field.key}`}
                            defaultChecked={contactFields[field.key]}
                            className="mt-1 h-4 w-4 rounded border-slate-300 accent-blue-600"
                          />
                          <label htmlFor={`contact_field_${field.key}`} className="cursor-pointer">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Contact field</span>
                            <span className="block text-sm font-semibold text-slate-900">{field.label}</span>
                            <span className="mt-1 block text-xs leading-5 text-slate-500">{field.description}</span>
                          </label>
                          <div className="col-span-2 justify-self-end sm:col-span-1 sm:col-start-3 sm:row-start-1">
                            <FlowMoveButtons
                              funnelId={funnel.id}
                              itemKey={itemKey}
                              itemLabel={field.label}
                              itemIndex={itemIndex}
                              totalItems={intakeFlowItems.length}
                            />
                          </div>
                        </div>
                      );
                    }

                    const question = funnel.questions.find((candidate) => candidate.id === item.id);
                    if (!question) return null;
                    const isQuestionEnabled = !disabledQuestionIds.includes(question.id);

                    return (
                      <div
                        key={itemKey}
                        className={`grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3 rounded-md border p-4 sm:grid-cols-[1.25rem_minmax(0,1fr)_auto] sm:items-center ${
                          isQuestionEnabled
                            ? "border-slate-200 bg-white"
                            : "border-slate-200 bg-slate-50 opacity-75"
                        }`}
                      >
                        <input form="contact-fields-form" type="hidden" name="intake_flow_order" value={itemKey} />
                        <input
                          form="contact-fields-form"
                          type="checkbox"
                          id={`question_enabled_${question.id}`}
                          name={`question_enabled_${question.id}`}
                          defaultChecked={isQuestionEnabled}
                          className="mt-1 h-4 w-4 rounded border-slate-300 accent-blue-600"
                        />
                        <label htmlFor={`question_enabled_${question.id}`} className="cursor-pointer">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            {isQuestionEnabled ? "Question" : "Question hidden from public flow"}
                          </span>
                          <span className="block text-sm font-semibold text-slate-900">{question.label}</span>
                          <span className="mt-1 block text-xs leading-5 text-slate-500">
                            {question.stable_key} • {question.question_type.replace("_", " ")} • {question.is_required ? "Required" : "Optional"}
                          </span>
                        </label>
                        <div className="col-span-2 justify-self-end sm:col-span-1 sm:col-start-3 sm:row-start-1">
                          <FlowMoveButtons
                            funnelId={funnel.id}
                            itemKey={itemKey}
                            itemLabel={question.label}
                            itemIndex={itemIndex}
                            totalItems={intakeFlowItems.length}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-500">
                  At least phone number or email must stay selected so the lead can be created and handed to GHL.
                </p>
              </div>

            </CardContent>
          </Card>
          <Card id="logo">
            <CardHeader>
              <CardTitle>Logo</CardTitle>
              <CardDescription>Optional. Drop in a logo file and it will render above the first-screen headline at a fixed max size.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
                {funnel.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={funnel.logo_url} alt="" className="max-h-16 max-w-48 object-contain" />
                ) : (
                  <div className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">No logo uploaded.</div>
                )}
                <form action={uploadLogoAction} className="space-y-3">
                  <input type="hidden" name="tenant_id" value={funnel.tenant_id} />
                  <input type="hidden" name="funnel_id" value={funnel.id} />
                  <LogoDropInput />
                  <p className="text-xs leading-5 text-slate-500">
                    Use PNG, JPG, WebP, or SVG. Horizontal logos work best; public pages cap display at 140px wide by 36px tall.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <SaveSubmitButton label="Save logo" variant="outline" />
                    {query.saved === "logo" ? <SavedBadge label="Logo uploaded" /> : null}
                  </div>
                </form>
              </div>
            </CardContent>
          </Card>

          <Card id="embed-links">
            <CardHeader>
              <SectionTitle icon={<Code2 className="h-5 w-5" />} title="Embed and links" />
              <CardDescription>Use these after the funnel is published.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <section className="grid gap-4 xl:grid-cols-3">
                <Snippet label="Full page" value={bookUrl} />
                <Snippet label="Iframe" value={buildIframeSnippet(embedUrl)} />
                <Snippet label="Popup" value={buildPopupSnippet(embedUrl)} />
              </section>
              <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-slate-950">GHL split-test iframe snippets</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Use the Control snippet in the control popup and the Variation snippet in the variation popup. Both use this same funnel and calendar, but analytics are tagged separately.
                  </p>
                </div>
                <div className="grid gap-4 xl:grid-cols-2">
                  <Snippet label="Control popup iframe" value={controlSplitIframe} />
                  <Snippet label="Variation popup iframe" value={variationSplitIframe} />
                </div>
              </section>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Danger zone</CardTitle>
              <CardDescription>Permanent funnel actions.</CardDescription>
            </CardHeader>
            <CardContent>
              <form action={deleteFunnelAction}>
                <input type="hidden" name="id" value={funnel.id} />
                <ConfirmDeleteButton
                  label="Delete funnel"
                  title="Delete this funnel?"
                  description={`This permanently deletes "${funnel.name}", including its questions, settings, and local funnel records. This cannot be undone.`}
                  variant="destructive"
                />
              </form>
            </CardContent>
          </Card>
        </section>
    </div>
  );
}

function actionSuccessMessage(saved?: string) {
  switch (saved) {
    case "duplicated":
      return "Funnel duplicated. You are editing the new draft copy.";
    case "question-deleted":
      return "Question deleted.";
    case "option-deleted":
      return "Answer option deleted.";
    case "question-order":
      return "Question order saved.";
    case "intake-flow":
      return "Intake flow saved.";
    case "analytics-filters":
      return "Analytics filters saved.";
    default:
      return null;
  }
}

function ActionSuccess({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="font-semibold">{message}</p>
    </div>
  );
}

function SavedBadge({ compact = false, label }: { compact?: boolean; label: string }) {
  return (
    <span
      className={
        compact
          ? "inline-flex items-center rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700"
          : "inline-flex items-center rounded-md bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700"
      }
    >
      <CheckCircle2 className={compact ? "mr-1 h-3.5 w-3.5" : "mr-1.5 h-4 w-4"} />
      {label}
    </span>
  );
}

function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-slate-500">{icon}</span>
      <CardTitle>{title}</CardTitle>
    </div>
  );
}

function AnalyticsControls({
  filtersSaved,
  funnelId,
  range,
  selectedCountryCodes,
  selectedTrafficSources
}: {
  filtersSaved: boolean;
  funnelId: string;
  range: AnalyticsDateRange;
  selectedCountryCodes: string[];
  selectedTrafficSources: string[];
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Date range</p>
        <DateRangeFilter range={range} />
      </div>
      <div className="mt-4 border-t border-slate-200 pt-4">
        <AnalyticsFilterForm
          funnelId={funnelId}
          saved={filtersSaved}
          selectedCountryCodes={selectedCountryCodes}
          selectedTrafficSources={selectedTrafficSources}
        />
      </div>
    </section>
  );
}

function DateRangeFilter({ range }: { range: AnalyticsDateRange }) {
  return (
    <form className="mt-3 grid gap-3 md:grid-cols-[190px_170px_170px_auto] md:items-end">
      <div className="space-y-1.5">
        <Label htmlFor="analytics-preset" className="text-xs text-slate-500">
          Range
        </Label>
        <select id="analytics-preset" name="preset" className={inputClass} defaultValue={range.preset}>
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="last_7_days">Last 7 days</option>
          <option value="last_30_days">Last 30 days</option>
          <option value="custom">Custom</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="analytics-from" className="text-xs text-slate-500">
          From
        </Label>
        <Input id="analytics-from" name="from" type="date" defaultValue={formatDateInput(range.from)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="analytics-to" className="text-xs text-slate-500">
          To
        </Label>
        <Input id="analytics-to" name="to" type="date" defaultValue={formatDateInput(range.to)} />
      </div>
      <Button type="submit" variant="outline" className="w-full md:w-auto">
        Apply
      </Button>
    </form>
  );
}

function AnalyticsFilterForm({
  funnelId,
  saved,
  selectedCountryCodes,
  selectedTrafficSources
}: {
  funnelId: string;
  saved: boolean;
  selectedCountryCodes: string[];
  selectedTrafficSources: string[];
}) {
  const selectedSource = selectedTrafficSources[0] ?? "";
  const selectedCountryLabels = analyticsCountryOptions
    .filter((country) => selectedCountryCodes.includes(country.code))
    .map((country) => country.label);
  const countrySummary =
    selectedCountryLabels.length === 0
      ? "All countries"
      : selectedCountryLabels.length === 1
        ? selectedCountryLabels[0]
        : `${selectedCountryLabels.length} countries selected`;

  return (
    <form
      action={updateAnalyticsTargetCountriesAction}
      className="grid gap-3 lg:grid-cols-[minmax(180px,0.9fr)_minmax(220px,1fr)_auto] lg:items-end"
    >
      <input type="hidden" name="id" value={funnelId} />
      <div className="space-y-1.5">
        <Label className="text-xs text-slate-500">Countries</Label>
        <details className="group relative">
          <summary className={`${inputClass} cursor-pointer list-none items-center justify-between [&::-webkit-details-marker]:hidden`}>
            <span className="truncate">{countrySummary}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180" />
          </summary>
          <div className="absolute left-0 top-[calc(100%+0.375rem)] z-20 w-full min-w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
            <p className="px-2 pb-2 text-xs leading-5 text-slate-500">
              Select one or more. Leave all unchecked to include every country.
            </p>
            <div className="space-y-1">
              {analyticsCountryOptions.map((country) => (
                <label
                  key={country.code}
                  className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 text-sm text-slate-800 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    name="analytics_target_country_codes"
                    value={country.code}
                    defaultChecked={selectedCountryCodes.includes(country.code)}
                    className="h-4 w-4 rounded border-slate-300 accent-slate-900"
                  />
                  <span>{country.label}</span>
                </label>
              ))}
            </div>
          </div>
        </details>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="analytics-source-filter" className="text-xs text-slate-500">
          Traffic source
        </Label>
        <select
          id="analytics-source-filter"
          name="analytics_traffic_sources"
          className={inputClass}
          defaultValue={selectedSource}
        >
          <option value="">All sources</option>
          {analyticsTrafficSourceOptions.map((source) => (
            <option key={source.value} value={source.value}>
              {source.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        {saved ? <SavedBadge compact label="Saved" /> : null}
        <SaveSubmitButton label="Save filters" variant="outline" />
      </div>
    </form>
  );
}

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function ActionError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
      <p className="font-semibold">This setting was not saved.</p>
      <p>{message}</p>
    </div>
  );
}

function SettingsJump({
  description,
  href,
  label
}: {
  description: string;
  href: string;
  label: string;
}) {
  return (
    <a
      href={href}
      className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
    >
      <span className="block text-sm font-semibold text-slate-950">{label}</span>
      <span className="mt-1 block text-sm leading-5 text-slate-500">{description}</span>
    </a>
  );
}

function SettingsGroup({
  children,
  description,
  icon,
  title
}: {
  children: ReactNode;
  description: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-start gap-3 border-b border-slate-100 bg-slate-50/80 px-4 py-4">
        <span className="mt-0.5 rounded-md bg-white p-2 text-slate-500 shadow-sm ring-1 ring-slate-200">{icon}</span>
        <div>
          <h3 className="text-base font-semibold text-slate-950">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
        </div>
      </div>
      <div className="space-y-4 p-4 sm:p-5">{children}</div>
    </section>
  );
}

function ToggleSetting({
  defaultChecked,
  description,
  name,
  title
}: {
  defaultChecked: boolean;
  description: string;
  name: string;
  title: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-800 transition hover:border-slate-300 hover:bg-slate-50">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-1" />
      <span>
        <span className="block font-semibold text-slate-950">{title}</span>
        <span className="mt-1 block leading-5 text-slate-500">{description}</span>
      </span>
    </label>
  );
}

function FlowMoveButtons({
  funnelId,
  itemIndex,
  itemKey,
  itemLabel,
  totalItems
}: {
  funnelId: string;
  itemIndex: number;
  itemKey: string;
  itemLabel: string;
  totalItems: number;
}) {
  return (
    <div className="flex items-center gap-1 self-end sm:self-auto" aria-label={`Move ${itemLabel}`}>
      <form action={moveIntakeFlowItemAction}>
        <input type="hidden" name="id" value={funnelId} />
        <input type="hidden" name="item_key" value={itemKey} />
        <input type="hidden" name="direction" value="up" />
        <Button type="submit" variant="ghost" size="icon" className="h-8 w-8" disabled={itemIndex === 0}>
          <ArrowUp className="h-4 w-4" />
          <span className="sr-only">Move {itemLabel} up</span>
        </Button>
      </form>
      <form action={moveIntakeFlowItemAction}>
        <input type="hidden" name="id" value={funnelId} />
        <input type="hidden" name="item_key" value={itemKey} />
        <input type="hidden" name="direction" value="down" />
        <Button type="submit" variant="ghost" size="icon" className="h-8 w-8" disabled={itemIndex === totalItems - 1}>
          <ArrowDown className="h-4 w-4" />
          <span className="sr-only">Move {itemLabel} down</span>
        </Button>
      </form>
    </div>
  );
}

function PipelineRoutingGroup({
  children,
  description,
  title
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div>
        <h4 className="text-sm font-semibold text-slate-950">{title}</h4>
        <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({
  defaultValue,
  inputId,
  label,
  max,
  min,
  name,
  placeholder,
  required = false,
  type = "text"
}: {
  defaultValue?: string | number;
  inputId?: string;
  label: string;
  max?: number;
  min?: number;
  name: string;
  placeholder?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={inputId ?? name}>{label}</Label>
      <Input
        id={inputId ?? name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        min={min}
        max={max}
        placeholder={placeholder}
        required={required}
      />
    </div>
  );
}

function ColorField({ label, name, value }: { label: string; name: string; value: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <div className="grid grid-cols-[48px_1fr] gap-2">
        <Input id={name} name={name} type="color" defaultValue={value} className="p-1" />
        <div className="flex items-center rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-600">{value}</div>
      </div>
    </div>
  );
}

function QuestionForm({
  tenantId,
  funnelId,
  nextOrder
}: {
  tenantId: string;
  funnelId: string;
  nextOrder: number;
}) {
  return (
    <form action={upsertQuestionAction} className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="funnel_id" value={funnelId} />
      <input type="hidden" name="is_required" value="on" />
      <div className="grid gap-3 md:grid-cols-[1fr_1.3fr_150px_90px_auto]">
        <Input name="stable_key" placeholder="stable_key" required />
        <Input name="label" placeholder="Question label" required />
        <select name="question_type" className={inputClass} defaultValue="text">
          {questionTypes.map((type) => (
            <option key={type} value={type}>
              {type.replace("_", " ")}
            </option>
          ))}
        </select>
        <Input name="display_order" type="number" defaultValue={nextOrder} aria-label="Display order" />
        <SaveSubmitButton label="Add" />
      </div>
    </form>
  );
}

function QuestionDisqualificationSettings({
  questionId,
  questionType,
  validation
}: {
  questionId: string;
  questionType: QuestionType;
  validation: Json;
}) {
  if (questionType === "single_select" || questionType === "multi_select") {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950 md:col-span-2">
        <p className="font-semibold">Disqualification</p>
        <p className="text-amber-900">
          Use the <strong>Disqualifies</strong> checkbox beside any answer option below.
        </p>
      </div>
    );
  }

  if (!supportsQuestionDisqualificationRule(questionType)) return null;

  const rule = resolveQuestionDisqualificationRule(validation, questionType);
  const operators = questionType === "number" ? numberDisqualificationOperators : stringDisqualificationOperators;
  const operatorId = `disqualification-operator-${questionId}`;
  const valueId = `disqualification-value-${questionId}`;

  return (
    <fieldset className="rounded-lg border border-amber-200 bg-amber-50 p-4 md:col-span-2">
      <legend className="px-1 text-sm font-semibold text-amber-950">Disqualification rule</legend>
      <label className="flex items-start gap-3 text-sm text-amber-950">
        <input
          type="checkbox"
          name="disqualification_enabled"
          defaultChecked={rule.enabled}
          className="mt-1 h-4 w-4 rounded border-amber-300 accent-amber-700"
        />
        <span>
          <span className="block font-semibold">Disqualify leads when this answer matches</span>
          <span className="mt-1 block leading-5 text-amber-900">
            Matching leads will not see the calendar and will move to the configured disqualified GHL stage.
          </span>
        </span>
      </label>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={operatorId}>Condition</Label>
          <select
            id={operatorId}
            name="disqualification_operator"
            className={inputClass}
            defaultValue={rule.operator}
          >
            {operators.map((operator) => (
              <option key={operator.value} value={operator.value}>
                {operator.label}
              </option>
            ))}
          </select>
        </div>
        <Field
          inputId={valueId}
          label={questionType === "number" ? "Comparison number" : "Comparison value"}
          name="disqualification_value"
          type={questionType === "number" ? "number" : "text"}
          defaultValue={rule.value}
          placeholder={questionType === "phone" ? "+1" : "Value to match"}
        />
      </div>
      <p className="mt-2 text-xs leading-5 text-amber-800">
        The comparison value is ignored when the condition is “Has any answer.”
      </p>
    </fieldset>
  );
}

function Metric({
  helper,
  label,
  value
}: {
  helper: string;
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-3xl font-semibold text-slate-950">{value}</div>
      <div className="mt-2 text-sm font-semibold text-slate-800">{label}</div>
      <div className="mt-1 text-xs leading-5 text-slate-500">{helper}</div>
    </div>
  );
}

function ConversionPath({
  leadToBookedRate,
  visitorToBookedRate,
  visitorToLeadRate
}: {
  leadToBookedRate: number;
  visitorToBookedRate: number;
  visitorToLeadRate: number;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">Conversion path</h3>
          <p className="mt-1 text-sm leading-6 text-slate-500">The three rates that decide the funnel winner.</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <ConversionPathStep label="Visitor to lead" value={formatRate(visitorToLeadRate)} />
        <ConversionPathStep label="Lead to booked" value={formatRate(leadToBookedRate)} />
        <ConversionPathStep label="Visitor to booked" value={formatRate(visitorToBookedRate)} />
      </div>
    </section>
  );
}

function ConversionPathStep({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg bg-slate-50 px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function SplitTestPerformanceTable({ rows }: { rows: SplitVariantPerformanceRow[] }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 bg-slate-50/50 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-950">Split-test performance</h3>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          Control, variation, and untagged traffic after the selected country and source filters. Untagged means the
          visit did not include a split-test variant.
        </p>
      </div>
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Variant</th>
                <th className="px-4 py-3 text-right font-semibold">Unique visitors</th>
                <th className="px-4 py-3 text-right font-semibold">Leads</th>
                <th className="px-4 py-3 text-right font-semibold">Calls booked</th>
                <th className="px-4 py-3 text-right font-semibold">Visitor to lead</th>
                <th className="px-4 py-3 text-right font-semibold">Lead to booked</th>
                <th className="px-4 py-3 text-right font-semibold">Visitor to booked</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.splitTestId}-${row.splitVariant}`} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <span className="block font-semibold capitalize text-slate-950">{row.splitVariant}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{row.splitTestId}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-800">{row.uniqueVisitors}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-800">{row.optInCount}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-800">{row.callsBookedCount}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-800">{formatRate(row.optInRate)}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-800">{formatRate(row.callBookingRate)}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-950">
                    {formatRate(row.visitorToBookedRate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-5 text-sm leading-6 text-slate-500">
          No split-test traffic yet. Paste the Control and Variation snippets into the matching GHL popups to start tracking this.
        </p>
      )}
    </section>
  );
}

function DropOffTable({ rows }: { rows: FunnelDropOffStepRow[] }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 bg-slate-50/50 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-950">Step drop-off</h3>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          Shows where unique visitors stop as they move through contact fields, questions, and calendar booking. Reached means viewed that step; advanced means moved past it.
        </p>
      </div>
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Step</th>
                <th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 text-right font-semibold">Reached</th>
                <th className="px-4 py-3 text-right font-semibold">Advanced</th>
                <th className="px-4 py-3 text-right font-semibold">Dropped</th>
                <th className="px-4 py-3 text-right font-semibold">Drop-off rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.stepKey} className="border-t border-slate-100">
                  <td className="max-w-md px-4 py-3">
                    <span className="block font-semibold text-slate-950">{row.stepLabel}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatStepType(row.stepType)}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-800">{row.uniqueVisitors}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-800">{row.continuedCount}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-800">{row.dropOffCount}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-950">{formatRate(row.dropOffRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-5 text-sm leading-6 text-slate-500">
          No step-level tracking yet. This will start filling after the latest public form update is deployed and visitors move through the funnel.
        </p>
      )}
    </section>
  );
}

function formatStepType(type: FunnelDropOffStepRow["stepType"]) {
  const labels: Record<FunnelDropOffStepRow["stepType"], string> = {
    page_view: "Page",
    contact: "Contact",
    question: "Question",
    calendar: "Calendar"
  };
  return labels[type];
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1 rounded-md bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="break-all font-medium text-slate-800">{value}</p>
    </div>
  );
}

function Snippet({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-800">{label}</p>
        <CopySnippetButton label={label} value={value} />
      </div>
      <pre className="max-h-32 overflow-x-auto rounded-md bg-slate-950 p-3 text-xs leading-5 text-white">{value}</pre>
    </div>
  );
}

function StatusBadge({ published }: { published: boolean }) {
  return (
    <span
      className={
        published
          ? "rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700"
          : "rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600"
      }
    >
      {published ? "Published" : "Draft"}
    </span>
  );
}

function formatRate(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}
