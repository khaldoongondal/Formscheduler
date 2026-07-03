"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import type { BookingFunnel, BookingQuestion } from "@/lib/funnels/service";
import {
  contactFieldOptions,
  resolveContactFieldConfig,
  resolveIntakeFlowOrder,
  type ContactFieldKey
} from "@/lib/funnels/contact-fields";
import { answerMatchesQuestionDisqualificationRule } from "@/lib/funnels/disqualification";
import { isValidWebsiteValue, websiteValidationMessage } from "@/lib/validation/website";
import { PhoneInput } from "@/components/booking/phone-input";

type FlowStep = "intake" | "slots" | "booked" | "disqualified";
type AnswerValue = string | string[];
type ContactValues = Partial<Record<ContactFieldKey, string>>;
type IntakePage =
  | { type: "contact"; fields: ContactFieldKey[] }
  | { type: "question"; question: BookingQuestion; questionNumber: number };

interface LeadSessionResponse {
  session: {
    id: string;
  };
}

interface SlotResponse {
  slots: Array<{
    startTime: string;
    endTime: string;
    timezone: string;
  }>;
}

interface SubmitAnswersResponse {
  session: {
    id: string;
  };
  qualified: boolean;
  disqualified: boolean;
}

interface BookingFlowProps {
  funnel: BookingFunnel;
  mode: "full" | "embed";
}

const baseButtonClass =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius)] px-5 py-3 text-base font-semibold transition disabled:pointer-events-none disabled:opacity-60";
const primaryButtonClass = `${baseButtonClass} border text-white shadow-sm active:translate-y-px`;
const outlineButtonClass = `${baseButtonClass} border border-slate-200 bg-white text-slate-950 hover:border-slate-300 hover:bg-slate-50`;
const backButtonClass = `${baseButtonClass} border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50`;
const inputClass =
  "flex min-h-12 w-full rounded-[var(--radius)] border border-slate-300 bg-white px-4 py-3 text-base text-slate-950 outline-none placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 disabled:cursor-not-allowed disabled:opacity-50";
const labelClass = "text-sm font-semibold text-slate-800";
const mutedTextClass = "text-sm leading-6 text-slate-600";
const brandDarkGreen = "#173f2d";
const brandAccentGreen = "#4f9a78";
const legacyScaffoldColors = new Set(["#111827", "#2563eb", "#3b82f6"]);
const fingerprintSubmitTimeoutMs = 300;
let fingerprintPromise: Promise<string | undefined> | null = null;

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? "Request failed.");
  }

  return body as T;
}

function hasAnswer(value: AnswerValue | undefined) {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value?.trim());
}

function getQuestionValidationError(question: BookingQuestion, value: AnswerValue | undefined) {
  if (question.is_required && !hasAnswer(value)) {
    return "Please answer this question.";
  }

  if (question.question_type === "url" && typeof value === "string" && value.trim() && !isValidWebsiteValue(value)) {
    return websiteValidationMessage;
  }

  return null;
}

function answerDisqualifiesQuestion(question: BookingQuestion, value: AnswerValue | undefined) {
  if (!value) return false;
  const selectedValues = new Set(Array.isArray(value) ? value : [value]);
  return (
    question.options.some((option) => option.is_disqualifying && selectedValues.has(option.value)) ||
    answerMatchesQuestionDisqualificationRule(question.question_type, question.validation, value)
  );
}

function formatSlotDate(startTime: string, timezone: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: timezone
  }).format(new Date(startTime));
}

function formatSlotTime(startTime: string, timezone: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone
  }).format(new Date(startTime));
}

function formatTimezoneLabel(timezone: string) {
  const fixedLabels: Record<string, string> = {
    "America/Toronto": "EST",
    "America/New_York": "EST",
    "America/Chicago": "CST",
    "America/Denver": "MST",
    "America/Phoenix": "MST",
    "America/Los_Angeles": "PST",
    "America/Vancouver": "PST"
  };

  if (fixedLabels[timezone]) {
    return fixedLabels[timezone];
  }

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "short"
    });
    const timezonePart = formatter.formatToParts(new Date()).find((part) => part.type === "timeZoneName");
    return timezonePart?.value || timezone;
  } catch {
    return timezone;
  }
}

function formatCalendarMonth(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric"
  }).format(date);
}

function colorWithAlpha(color: string, alpha: number) {
  const normalized = color.trim().replace("#", "");
  const hex =
    normalized.length === 3
      ? normalized
          .split("")
          .map((character) => `${character}${character}`)
          .join("")
      : normalized;

  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return `rgba(79, 154, 120, ${alpha})`;
  }

  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function resolveBrandColor(color: string, fallback: string) {
  return legacyScaffoldColors.has(color.trim().toLowerCase()) ? fallback : color;
}

function redirectAfterBooking(redirectUrl: string) {
  const redirectMessage = { type: "leadder:redirect", url: redirectUrl };

  try {
    window.parent?.postMessage(redirectMessage, "*");
  } catch {
    // Some embed contexts restrict parent access. Continue to direct navigation fallbacks.
  }

  try {
    window.opener?.postMessage(redirectMessage, "*");
  } catch {
    // Popup embeds may not have an opener, or the opener may be cross-origin restricted.
  }

  window.setTimeout(() => {
    try {
      if (window.top && window.top !== window.self) {
        window.top.location.assign(redirectUrl);
        return;
      }
    } catch {
      // Cross-origin embeds can block top-level navigation. Fall back to redirecting the frame.
    }

    window.location.assign(redirectUrl);
  }, 100);
}

function getCalendarPreviewDays(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const mondayFirstOffset = (firstDay.getDay() + 6) % 7;

  return [
    ...Array.from({ length: mondayFirstOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1)
  ];
}

function getVisitorId() {
  const key = "leadder_visitor_id";
  const generated =
    window.crypto?.randomUUID?.() ?? `visitor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    window.localStorage.setItem(key, generated);
  } catch {
    return generated;
  }
  return generated;
}

function getTrackingParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    utm_source: params.get("utm_source") ?? undefined,
    utm_medium: params.get("utm_medium") ?? undefined,
    utm_campaign: params.get("utm_campaign") ?? undefined,
    utm_content: params.get("utm_content") ?? undefined,
    utm_term: params.get("utm_term") ?? undefined,
    utm_adset: params.get("utm_adset") ?? undefined,
    utm_adid: params.get("utm_adid") ?? undefined,
    utm_adsetid: params.get("utm_adsetid") ?? undefined,
    utm_campaignid: params.get("utm_campaignid") ?? undefined,
    utm_id: params.get("utm_id") ?? undefined,
    fbc: params.get("fbc") ?? undefined,
    fbp: params.get("fbp") ?? undefined,
    fbclid: params.get("fbclid") ?? undefined,
    gclid: params.get("gclid") ?? undefined,
    ttclid: params.get("ttclid") ?? undefined,
    split_test_id: params.get("split_test_id") ?? undefined,
    split_variant: params.get("split_variant") ?? undefined,
    landing_page_url: params.get("landing_page_url") ?? undefined
  };
}

async function getBrowserFingerprint() {
  if (typeof window === "undefined") return undefined;

  fingerprintPromise ??= import("@thumbmarkjs/thumbmarkjs")
    .then(({ Thumbmark }) => new Thumbmark().get())
    .then((result) => (typeof result.thumbmark === "string" ? result.thumbmark : undefined))
    .catch(() => undefined);

  return fingerprintPromise;
}

function getBrowserFingerprintWithTimeout(timeoutMs = fingerprintSubmitTimeoutMs) {
  return new Promise<string | undefined>((resolve) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      settled = true;
      resolve(undefined);
    }, timeoutMs);

    void getBrowserFingerprint().then((value) => {
      if (settled) return;
      window.clearTimeout(timeoutId);
      resolve(value);
    });
  });
}

function buildIntakePages(funnel: BookingFunnel): IntakePage[] {
  const contactFieldConfig = resolveContactFieldConfig(funnel.qualification_rule);
  const questionsById = new Map(funnel.questions.map((question) => [question.id, question]));
  const questionIds = funnel.questions.map((question) => question.id);
  const flowItems = resolveIntakeFlowOrder(funnel.qualification_rule, questionIds);
  const pages: IntakePage[] = [];
  const pendingContactFields: ContactFieldKey[] = [];
  let questionNumber = 0;

  const flushContactFields = () => {
    while (pendingContactFields.length) {
      pages.push({
        type: "contact",
        fields: pendingContactFields.splice(0, contactFieldConfig.fieldsPerPage)
      });
    }
  };

  for (const item of flowItems) {
    if (item.type === "contact") {
      if (contactFieldConfig.settings[item.key]) {
        pendingContactFields.push(item.key);
      }
      continue;
    }

    flushContactFields();
    const question = questionsById.get(item.id);
    if (question) {
      questionNumber += 1;
      pages.push({ type: "question", question, questionNumber });
    }
  }

  flushContactFields();
  return pages;
}

function getContactFieldLabel(fieldKey: ContactFieldKey) {
  return contactFieldOptions.find((field) => field.key === fieldKey)?.label ?? fieldKey.replace("_", " ");
}

function splitFullName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);

  if (!parts.length) {
    return { firstName: "", lastName: "" };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ")
  };
}

function getIntakePageTrackingMetadata(page: IntakePage, pageIndex: number) {
  if (page.type === "contact") {
    return {
      step_key: `contact:${pageIndex + 1}:${page.fields.join(",")}`,
      step_index: pageIndex + 1,
      step_type: "contact",
      step_label: `Contact: ${page.fields.map(getContactFieldLabel).join(" + ")}`,
      contact_fields: page.fields
    };
  }

  return {
    step_key: `question:${page.question.id}`,
    step_index: pageIndex + 1,
    step_type: "question",
    step_label: page.question.label,
    question_id: page.question.id,
    question_stable_key: page.question.stable_key,
    question_number: page.questionNumber
  };
}

export function BookingFlow({ funnel, mode }: BookingFlowProps) {
  const [step, setStep] = useState<FlowStep>("intake");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [intakePageIndex, setIntakePageIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [contactValues, setContactValues] = useState<ContactValues>({});
  const [slots, setSlots] = useState<SlotResponse["slots"]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [visitorId, setVisitorId] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const trackedStepViewsRef = useRef<Set<string>>(new Set());

  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const intakePages = useMemo(() => buildIntakePages(funnel), [funnel]);
  const currentIntakePage = intakePages[intakePageIndex];
  const activeQuestions = useMemo(
    () => intakePages
      .filter((page): page is Extract<IntakePage, { type: "question" }> => page.type === "question")
      .map((page) => page.question),
    [intakePages]
  );
  const questionCount = activeQuestions.length;
  const groupedSlots = useMemo(() => groupSlotsByDate(slots, timezone), [slots, timezone]);
  const contactFieldConfig = useMemo(() => resolveContactFieldConfig(funnel.qualification_rule), [funnel.qualification_rule]);
  const contactFields = contactFieldConfig.settings;
  const flowItems = useMemo(
    () => resolveIntakeFlowOrder(funnel.qualification_rule, funnel.questions.map((question) => question.id)),
    [funnel.qualification_rule, funnel.questions]
  );
  const activeContactFieldOrder = flowItems
    .filter((item): item is { type: "contact"; key: ContactFieldKey } => item.type === "contact" && contactFields[item.key])
    .map((item) => item.key);
  const firstActiveContactField = flowItems.find((item) => item.type === "contact" && contactFields[item.key]);
  const pulsedContactField = funnel.phone_pulse_enabled && firstActiveContactField?.type === "contact" ? firstActiveContactField.key : null;
  const isEmbed = mode === "embed";
  const accentColor = resolveBrandColor(funnel.accent_color, brandAccentGreen);
  const buttonColor = resolveBrandColor(funnel.button_color, brandDarkGreen);
  const accentSoftColor = colorWithAlpha(accentColor, 0.13);
  const themeStyle = {
    "--radius": `${funnel.border_radius}px`,
    "--leadder-accent": accentColor,
    "--leadder-accent-soft": accentSoftColor,
    "--leadder-button": buttonColor
  } as CSSProperties;
  const buttonStyle = { backgroundColor: buttonColor, borderColor: buttonColor };
  const selectedButtonStyle = { backgroundColor: buttonColor, borderColor: buttonColor };
  const showIntroPanel = step === "intake" && intakePageIndex === 0;
  const showFirstPageTerms = step === "intake" && intakePageIndex === 0;
  const isLastIntakePage = intakePageIndex >= intakePages.length - 1;
  const showIntroHeadline = funnel.show_intro_headline !== false;
  const showIntroDescription = funnel.show_intro_description !== false;
  const hasIntroContent =
    Boolean(funnel.logo_url) ||
    showIntroHeadline ||
    Boolean(showIntroDescription && funnel.description);
  const showIntroBlock = showIntroPanel && hasIntroContent;
  const showIntakeBackButton = step === "intake" && intakePageIndex > 0;
  const currentQuestion = currentIntakePage?.type === "question" ? currentIntakePage.question : null;
  const showQuestionNextButton =
    step === "intake" && Boolean(currentQuestion) && currentQuestion?.question_type !== "single_select";
  const isFinishedState = step === "booked" || step === "disqualified";
  const intakePanelClassName = isEmbed
    ? "flex w-full flex-col border-b border-slate-200 bg-white"
    : step === "slots"
      ? "hidden w-full flex-col border-b border-slate-200 bg-white lg:flex lg:min-h-[590px] lg:border-b-0 lg:border-r lg:border-slate-200"
      : "flex w-full flex-col border-b border-slate-200 bg-white lg:min-h-[590px] lg:border-b-0 lg:border-r lg:border-slate-200";

  useEffect(() => {
    const id = getVisitorId();
    const trackingParams = getTrackingParams();
    setVisitorId(id);
    void postJson("/api/analytics", {
      funnel_id: funnel.id,
      visitor_id: id,
      event_type: "page_view",
      source: mode,
      source_url: window.location.href,
      user_agent: window.navigator.userAgent,
      metadata: trackingParams
    }).catch(() => undefined);
  }, [funnel.id, mode]);

  useEffect(() => {
    if (!visitorId) return;

    const trackingParams = getTrackingParams();
    const stepMetadata =
      step === "intake" && currentIntakePage
        ? getIntakePageTrackingMetadata(currentIntakePage, intakePageIndex)
        : step === "slots"
          ? {
              step_key: "slots",
              step_index: intakePages.length + 1,
              step_type: "calendar",
              step_label: "Calendar availability"
            }
          : null;

    if (!stepMetadata) return;

    const dedupeKey = `${stepMetadata.step_key}:${sessionId ?? visitorId}`;
    if (trackedStepViewsRef.current.has(dedupeKey)) return;
    trackedStepViewsRef.current.add(dedupeKey);

    void postJson("/api/analytics", {
      funnel_id: funnel.id,
      lead_session_id: sessionId ?? undefined,
      visitor_id: visitorId,
      event_type: "step_view",
      source: mode,
      source_url: window.location.href,
      user_agent: window.navigator.userAgent,
      metadata: {
        ...trackingParams,
        ...stepMetadata
      }
    }).catch(() => undefined);
  }, [currentIntakePage, funnel.id, intakePageIndex, intakePages.length, mode, sessionId, step, visitorId]);

  useEffect(() => {
    let isMounted = true;

    void getBrowserFingerprint().then((value) => {
      if (isMounted && value) {
        setFingerprint(value);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!sessionId || step === "booked" || step === "disqualified") return;

    const onBeforeUnload = () => {
      const payload = JSON.stringify({ lead_session_id: sessionId });
      navigator.sendBeacon?.("/api/lead-sessions/abandon", new Blob([payload], { type: "application/json" }));
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [sessionId, step]);

  function getContactValidationError(values: ContactValues, fields: ContactFieldKey[], requireContactIdentity = true) {
    for (const field of fields) {
      const value = values[field]?.trim() ?? "";

      if (!value) {
        return field === "full_name" ? "Please add your name." : `Please add your ${field.replace("_", " ")}.`;
      }

      if (field === "phone" && !/^\+\d{8,15}$/.test(value)) {
        return "Please add a valid phone number.";
      }

      if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return "Please add a valid email address.";
      }
    }

    if (requireContactIdentity && !values.phone?.trim() && !values.email?.trim()) {
      return "Please add a phone number or email address.";
    }

    return null;
  }

  async function ensureLeadSession(values: ContactValues) {
    if (sessionId) return sessionId;

    const typedFullName = values.full_name?.trim() ?? "";
    const nameParts = splitFullName(typedFullName);
    const firstName = values.first_name?.trim() || nameParts.firstName;
    const lastName = values.last_name?.trim() || nameParts.lastName;
    const fullName = typedFullName || `${firstName} ${lastName}`.trim();
    const resolvedFingerprint = fingerprint ?? (await getBrowserFingerprintWithTimeout());
    if (resolvedFingerprint && !fingerprint) {
      setFingerprint(resolvedFingerprint);
    }
    const response = await postJson<LeadSessionResponse>("/api/lead-sessions", {
      funnel_id: funnel.id,
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      email: values.email?.trim() ?? "",
      phone: values.phone?.trim() ?? "",
      visitor_id: visitorId ?? getVisitorId(),
      source_url: window.location.href,
      referrer: document.referrer || undefined,
      fingerprint: resolvedFingerprint,
      ...getTrackingParams()
    });
    const leadSessionId = response.session.id;
    setSessionId(leadSessionId);
    return leadSessionId;
  }

  async function handleContactPageSubmit(event: FormEvent<HTMLFormElement>, fields: ContactFieldKey[]) {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);
    const nextContactValues = fields.reduce<ContactValues>(
      (values, field) => ({
        ...values,
        [field]: String(formData.get(field) ?? "").trim()
      }),
      { ...contactValues }
    );
    const currentPageError = getContactValidationError(nextContactValues, fields, false);
    if (currentPageError) {
      setError(currentPageError);
      return;
    }

    setContactValues(nextContactValues);

    const allContactFieldsComplete = !getContactValidationError(nextContactValues, activeContactFieldOrder);
    setIsLoading(true);
    try {
      const leadSessionId = allContactFieldsComplete ? await ensureLeadSession(nextContactValues) : sessionId;
      await advanceFromIntakePage(leadSessionId ?? undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to continue.");
    } finally {
      setIsLoading(false);
    }
  }

  async function saveAnswers(leadSessionId: string, answerSnapshot: Record<string, AnswerValue> = answers) {
    return postJson<SubmitAnswersResponse>("/api/lead-sessions/answers", {
      lead_session_id: leadSessionId,
      answers: funnel.questions
        .filter((question) => answerSnapshot[question.id] !== undefined)
        .map((question) => ({
          question_id: question.id,
          value: answerSnapshot[question.id] ?? ""
        }))
    });
  }

  async function loadSlots(leadSessionId: string) {
    setStep("slots");
    const response = await postJson<SlotResponse>("/api/bookings/slots", {
      lead_session_id: leadSessionId,
      timezone
    });
    setSlots(response.slots);
  }

  async function bookSlot(slot: SlotResponse["slots"][number]) {
    if (!sessionId) return;
    setSelectedSlot(slot.startTime);
    setError(null);

    try {
      await postJson("/api/bookings", {
        lead_session_id: sessionId,
        slot_start: slot.startTime,
        slot_end: slot.endTime,
        timezone
      });
      if (funnel.redirect_url) {
        redirectAfterBooking(funnel.redirect_url);
        return;
      }
      setStep("booked");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to book this slot.");
    } finally {
      setSelectedSlot(null);
    }
  }

  function getQuestionPageIndex(questionId: string) {
    return intakePages.findIndex((page) => page.type === "question" && page.question.id === questionId);
  }

  function getFirstContactPageIndex() {
    return intakePages.findIndex((page) => page.type === "contact");
  }

  async function completeIntake(answerSnapshot: Record<string, AnswerValue>, leadSessionId = sessionId) {
    if (!leadSessionId) {
      const firstContactPageIndex = getFirstContactPageIndex();
      setError("Please enter your contact details first.");
      setIntakePageIndex(firstContactPageIndex >= 0 ? firstContactPageIndex : 0);
      return;
    }

    const hasDisqualifyingAnswer = activeQuestions.some((question) =>
      answerDisqualifiesQuestion(question, answerSnapshot[question.id])
    );

    if (!hasDisqualifyingAnswer) {
      const firstInvalidQuestionIndex = activeQuestions.findIndex((question) =>
        Boolean(getQuestionValidationError(question, answerSnapshot[question.id]))
      );
      if (firstInvalidQuestionIndex >= 0) {
        const invalidQuestion = activeQuestions[firstInvalidQuestionIndex];
        const invalidPageIndex = getQuestionPageIndex(invalidQuestion.id);
        setIntakePageIndex(invalidPageIndex >= 0 ? invalidPageIndex : intakePageIndex);
        setError(getQuestionValidationError(invalidQuestion, answerSnapshot[invalidQuestion.id]));
        return;
      }
    }

    setError(null);
    setIsLoading(true);
    try {
      const hasSavedAnswers = funnel.questions.some((question) => answerSnapshot[question.id] !== undefined);
      if (hasSavedAnswers) {
        const result = await saveAnswers(leadSessionId, answerSnapshot);
        if (result.disqualified) {
          setStep("disqualified");
          return;
        }
      }
      await loadSlots(leadSessionId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to continue.");
    } finally {
      setIsLoading(false);
    }
  }

  async function advanceFromIntakePage(leadSessionId = sessionId, answerSnapshot: Record<string, AnswerValue> = answers) {
    setError(null);
    const currentPage = intakePages[intakePageIndex];
    const question = currentPage?.type === "question" ? currentPage.question : null;

    if (question) {
      const validationError = getQuestionValidationError(question, answerSnapshot[question.id]);
      if (validationError) {
        setError(validationError);
        return;
      }
    }

    const hasDisqualifyingAnswer = activeQuestions.some((candidate) =>
      answerDisqualifiesQuestion(candidate, answerSnapshot[candidate.id])
    );
    if (leadSessionId && hasDisqualifyingAnswer) {
      await completeIntake(answerSnapshot, leadSessionId);
      return;
    }

    if (intakePageIndex < intakePages.length - 1) {
      setIntakePageIndex((currentIndex) => (currentIndex === intakePageIndex ? currentIndex + 1 : currentIndex));
      return;
    }

    await completeIntake(answerSnapshot, leadSessionId);
  }

  function handleQuestionAnswer(question: BookingQuestion, value: AnswerValue) {
    const nextAnswers = { ...answers, [question.id]: value };
    setAnswers(nextAnswers);

    if (question.question_type === "single_select") {
      window.setTimeout(() => {
        void advanceFromIntakePage(sessionId, nextAnswers);
      }, 180);
    }
  }

  function renderContactField(fieldKey: ContactFieldKey) {
    const pulseClass = fieldKey === pulsedContactField ? "leadder-contact-pulse" : undefined;

    if (fieldKey === "phone") {
      return <PhoneInput key={fieldKey} className={pulseClass} defaultValue={contactValues.phone} />;
    }

    if (fieldKey === "email") {
      return (
        <Field
          key={fieldKey}
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="Email"
          inputClassName={pulseClass}
          defaultValue={contactValues.email}
          required
        />
      );
    }

    if (fieldKey === "full_name") {
      return (
        <Field
          key={fieldKey}
          label="Name"
          name="full_name"
          autoComplete="name"
          placeholder="Name"
          inputClassName={pulseClass}
          defaultValue={contactValues.full_name}
          required
        />
      );
    }

    if (fieldKey === "first_name") {
      return (
        <Field
          key={fieldKey}
          label="First Name"
          name="first_name"
          autoComplete="given-name"
          placeholder="First Name"
          inputClassName={pulseClass}
          defaultValue={contactValues.first_name}
          required
        />
      );
    }

    return (
      <Field
        key={fieldKey}
        label="Last Name"
        name="last_name"
        autoComplete="family-name"
        placeholder="Last Name"
        inputClassName={pulseClass}
        defaultValue={contactValues.last_name}
        required
      />
    );
  }

  return (
    <main className="min-h-screen bg-white p-1 text-slate-950 sm:p-2 lg:p-3" style={themeStyle}>
      <section
        className={
          isEmbed
            ? "mx-auto flex max-w-xl flex-col overflow-hidden rounded-[10px] border border-slate-300 bg-white"
            : "mx-auto grid max-w-[1080px] items-stretch overflow-hidden rounded-[10px] border border-slate-300 bg-white px-0 py-0 lg:grid-cols-[minmax(360px,0.86fr)_minmax(420px,1fr)] lg:grid-rows-[auto_1fr]"
        }
      >
        <StageTabs activeColor={accentColor} isBookingStage={step === "slots" || step === "booked"} />

        {isFinishedState ? (
          step === "booked" ? (
          <BookedConfirmation buttonStyle={buttonStyle} />
          ) : (
            <DisqualifiedConfirmation buttonStyle={buttonStyle} />
          )
        ) : (
          <>
            <div
              className={intakePanelClassName}
            >
              {showIntroBlock ? (
                <div className="border-b border-slate-100 px-5 py-4 sm:px-7 sm:py-5 lg:px-8">
                  <FunnelIntro funnel={funnel} />
                </div>
              ) : null}

              <div
                className={
                  isEmbed
                    ? "overflow-hidden bg-white"
                    : "flex flex-1 flex-col bg-white"
                }
              >
                <div className={isEmbed ? "p-5 sm:p-7" : showIntroPanel ? "p-5 sm:p-7 lg:px-8 lg:py-5" : "p-5 sm:p-7 lg:p-8"}>
                  {step === "intake" && currentIntakePage?.type === "contact" ? (
                    <form
                      onSubmit={(event) => void handleContactPageSubmit(event, currentIntakePage.fields)}
                      className="space-y-4 sm:space-y-5"
                    >
                      {currentIntakePage.fields.map((fieldKey) => renderContactField(fieldKey))}
                      <div className="space-y-3 pt-1">
                        <button
                          type="submit"
                          className={`${primaryButtonClass} w-full`}
                          style={buttonStyle}
                          disabled={isLoading}
                        >
                          {isLoading ? <Spinner /> : null}
                          {isLastIntakePage ? "Continue" : "Next"}
                        </button>
                        {showIntakeBackButton ? (
                          <button
                            type="button"
                            className={`${backButtonClass} w-full`}
                            onClick={() => setIntakePageIndex((index) => Math.max(0, index - 1))}
                            disabled={isLoading}
                          >
                            Back
                          </button>
                        ) : null}
                      </div>
                      {showFirstPageTerms ? <TermsNote className="-mt-1" /> : null}
                    </form>
                  ) : null}

                  {step === "intake" && currentIntakePage?.type === "question" && currentQuestion ? (
                    <div className={showIntroPanel ? "space-y-4 sm:space-y-5" : "space-y-6"}>
                      <StepHeading
                        eyebrow={`Question ${currentIntakePage.questionNumber} of ${questionCount}`}
                        title={currentQuestion.label}
                        body={currentQuestion.help_text ?? undefined}
                        required={currentQuestion.is_required}
                        compact={showIntroPanel}
                      />
                      <QuestionInput
                        question={currentQuestion}
                        value={answers[currentQuestion.id]}
                        onChange={(value) => handleQuestionAnswer(currentQuestion, value)}
                        selectedStyle={selectedButtonStyle}
                        compact={showIntroPanel}
                      />
                      {!showQuestionNextButton && showFirstPageTerms ? <TermsNote /> : null}
                      {showIntakeBackButton || showQuestionNextButton ? (
                        <div className="space-y-3 pt-1">
                          {showQuestionNextButton ? (
                            <button
                              type="button"
                              className={`${primaryButtonClass} w-full`}
                              style={buttonStyle}
                              disabled={(currentQuestion.is_required && !hasAnswer(answers[currentQuestion.id])) || isLoading}
                              onClick={() => void advanceFromIntakePage()}
                            >
                              {isLoading ? <Spinner /> : null}
                              {isLastIntakePage ? "Continue" : "Next"}
                            </button>
                          ) : null}
                          {showIntakeBackButton ? (
                            <button
                              type="button"
                              className={`${backButtonClass} w-full`}
                              onClick={() => setIntakePageIndex((index) => Math.max(0, index - 1))}
                              disabled={isLoading}
                            >
                              Back
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      {showQuestionNextButton && showFirstPageTerms ? <TermsNote className="-mt-1" /> : null}
                    </div>
                  ) : null}

                  {step === "slots" ? (
                    isEmbed ? (
                      <SlotPicker
                        groupedSlots={groupedSlots}
                        isLoading={isLoading}
                        onBookSlot={bookSlot}
                        selectedSlot={selectedSlot}
                        timezone={timezone}
                      />
                    ) : (
                      <div className="space-y-5">
                        <div className="rounded-[var(--radius)] border border-slate-200 bg-slate-50 px-5 py-5 leading-6 text-slate-600">
                          <p className="text-sm font-semibold uppercase tracking-wide text-[var(--leadder-accent)]">
                            Intake complete
                          </p>
                          <p className="mt-2 text-base">
                            Select an available time to finish booking.
                          </p>
                        </div>
                      </div>
                    )
                  ) : null}

                  {error ? (
                    <p className="mt-5 rounded-[var(--radius)] border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700" role="alert">
                      {error}
                    </p>
                  ) : null}
                </div>
              </div>

            </div>

            {!isEmbed || step !== "slots" ? (
              <BookingPanel
                groupedSlots={groupedSlots}
                isLoading={isLoading}
                onBookSlot={bookSlot}
                selectedSlot={selectedSlot}
                step={step}
                timezone={timezone}
                accentSoftColor={accentSoftColor}
                className={isEmbed ? "bg-white" : "bg-white lg:min-h-[590px]"}
              />
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}

function BookedConfirmation({ buttonStyle }: { buttonStyle: CSSProperties }) {
  return (
    <div className="flex min-h-[420px] items-center justify-center px-5 py-12 text-center sm:px-8 lg:col-span-2 lg:min-h-[540px]">
      <div className="mx-auto max-w-lg space-y-5">
        <div
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-full text-sm font-semibold text-white shadow-sm"
          style={buttonStyle}
        >
          OK
        </div>
        <StepHeading
          eyebrow="Confirmed"
          title="You are booked."
          body="The appointment was created. Keep an eye on your inbox or phone for confirmation details."
          align="center"
        />
      </div>
    </div>
  );
}

function DisqualifiedConfirmation({ buttonStyle }: { buttonStyle: CSSProperties }) {
  return (
    <div className="flex min-h-[420px] items-center justify-center px-5 py-12 text-center sm:px-8 lg:col-span-2 lg:min-h-[540px]">
      <div className="mx-auto max-w-lg space-y-5">
        <div
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-full text-sm font-semibold text-white shadow-sm"
          style={buttonStyle}
        >
          OK
        </div>
        <StepHeading
          eyebrow="Thanks"
          title="Thank you for your interest."
          body="We received your information and will reach out if there is a fit."
          align="center"
        />
      </div>
    </div>
  );
}

function StageTabs({ activeColor, isBookingStage }: { activeColor: string; isBookingStage: boolean }) {
  const firstStepStyle = isBookingStage ? undefined : { color: activeColor };
  const secondStepStyle = isBookingStage ? { color: activeColor } : undefined;

  return (
    <div className="border-b border-slate-200 bg-white py-2.5 text-center sm:py-3 lg:col-span-2">
      <div className="mx-auto flex max-w-xl items-center justify-center gap-4 text-[13px] font-semibold sm:gap-8 sm:text-base">
        <span
          className={isBookingStage ? "flex items-center gap-1.5 whitespace-nowrap text-slate-400 sm:gap-2" : "flex items-center gap-1.5 whitespace-nowrap sm:gap-2"}
          style={firstStepStyle}
        >
          <span
            className={`h-2 w-2 shrink-0 rounded-full sm:h-2.5 sm:w-2.5 ${isBookingStage ? "bg-slate-300" : ""}`}
            style={isBookingStage ? undefined : { backgroundColor: activeColor }}
          />
          1 - Fill out the form
        </span>
        <span
          className={isBookingStage ? "flex items-center gap-1.5 whitespace-nowrap sm:gap-2" : "flex items-center gap-1.5 whitespace-nowrap text-slate-400 sm:gap-2"}
          style={secondStepStyle}
        >
          <span
            className={`h-2 w-2 shrink-0 rounded-full sm:h-2.5 sm:w-2.5 ${isBookingStage ? "" : "bg-slate-300"}`}
            style={isBookingStage ? { backgroundColor: activeColor } : undefined}
          />
          2 - Book your event
        </span>
      </div>
    </div>
  );
}

function FunnelIntro({
  funnel
}: {
  funnel: BookingFunnel;
}) {
  const showHeadline = funnel.show_intro_headline !== false;
  const showDescription = funnel.show_intro_description !== false && Boolean(funnel.description);
  const hasIntroText = showHeadline || showDescription;
  const logoAlignmentClass = funnel.logo_alignment === "center" ? "justify-center" : "justify-start";

  return (
    <div>
      {funnel.logo_url ? (
        <div className={`${hasIntroText ? "mb-3" : ""} flex h-9 items-center ${logoAlignmentClass}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={funnel.logo_url} alt="" className="h-auto max-h-8 w-auto max-w-[140px] object-contain" />
        </div>
      ) : null}
      {showHeadline ? (
        <h1 className="text-[25px] font-semibold leading-tight text-slate-950 sm:text-[28px]">
          {funnel.name}
        </h1>
      ) : null}
      {showDescription ? (
        <p className="mt-2 max-w-md text-base leading-6 text-slate-600">
          {funnel.description}
        </p>
      ) : null}
    </div>
  );
}

function BookingPanel({
  className = "",
  groupedSlots,
  isLoading,
  onBookSlot,
  selectedSlot,
  step,
  timezone,
  accentSoftColor
}: {
  accentSoftColor: string;
  className?: string;
  groupedSlots: Array<{ dateLabel: string; slots: SlotResponse["slots"] }>;
  isLoading: boolean;
  onBookSlot: (slot: SlotResponse["slots"][number]) => void | Promise<void>;
  selectedSlot: string | null;
  step: FlowStep;
  timezone: string;
}) {
  const isUnlocked = step === "slots" || step === "booked";
  const showPanelHeader = step !== "slots";

  return (
    <aside className="w-full overflow-hidden">
      <div className={`${className} flex h-full flex-col overflow-hidden`}>
        {showPanelHeader ? (
          <div className="border-b border-slate-200 bg-white px-5 py-4 text-center sm:px-7 lg:py-5">
            <p className="text-base font-semibold text-slate-800">{isUnlocked ? "Select a time" : "Select a day"}</p>
          </div>
        ) : null}
        <div className={showPanelHeader ? "flex-1 p-4 sm:p-6 lg:px-8 lg:py-6" : "flex-1 p-5 sm:p-7 lg:px-8 lg:py-8"}>
          {step === "booked" ? (
            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">
                OK
              </div>
              <p className="font-semibold text-slate-950">Your appointment is confirmed.</p>
              <p className="text-sm leading-6 text-slate-600">Confirmation details will be sent to the contact information provided.</p>
            </div>
          ) : step === "slots" ? (
            <SlotPicker
              groupedSlots={groupedSlots}
              isLoading={isLoading}
              onBookSlot={onBookSlot}
              selectedSlot={selectedSlot}
              timezone={timezone}
            />
          ) : (
            <LockedCalendarPreview accentSoftColor={accentSoftColor} />
          )}
        </div>
      </div>
    </aside>
  );
}

function LockedCalendarPreview({ accentSoftColor }: { accentSoftColor: string }) {
  const now = new Date();
  const days = getCalendarPreviewDays(now);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const highlightedDays = new Set(
    [now.getDate() + 2, now.getDate() + 3, now.getDate() + 6].filter((day) => day > 0 && day <= daysInMonth)
  );

  return (
    <div className="relative min-h-[330px] overflow-hidden bg-white sm:min-h-[370px] lg:min-h-[430px]" aria-disabled="true">
      <div className="pointer-events-none select-none opacity-50 blur-[0.55px]">
        <div className="mb-4 flex items-center justify-between text-slate-500">
          <span className="text-2xl leading-none text-slate-700" aria-hidden="true">
            ←
          </span>
          <p className="font-semibold text-slate-800">{formatCalendarMonth(now)}</p>
          <span className="text-2xl leading-none text-slate-700" aria-hidden="true">
            →
          </span>
        </div>
        <div className="grid grid-cols-7 gap-1.5 text-center text-sm sm:gap-2">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div key={day} className="py-2 font-semibold text-slate-400">
              {day}
            </div>
          ))}
          {days.map((day, index) => (
            <div
              key={`${day ?? "blank"}-${index}`}
              className={`flex aspect-square items-center justify-center rounded-lg text-base ${day && highlightedDays.has(day) ? "text-slate-500" : "text-slate-400"}`}
              style={day && highlightedDays.has(day) ? { backgroundColor: accentSoftColor } : undefined}
            >
              {day}
            </div>
          ))}
        </div>
      </div>
      <div className="absolute inset-0 bg-white/20" aria-hidden="true" />
      <div className="absolute left-1/2 top-[46%] w-[min(290px,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-slate-200 bg-white px-5 py-4 text-center text-sm font-semibold leading-6 text-slate-800 shadow-[0_12px_30px_rgba(15,23,42,0.16)]">
        Please fill out the form before choosing your time slot.
      </div>
    </div>
  );
}

function StepHeading({
  align = "left",
  body,
  compact = false,
  eyebrow,
  required = false,
  title
}: {
  align?: "left" | "center";
  body?: string;
  compact?: boolean;
  eyebrow?: string;
  required?: boolean;
  title: string;
}) {
  const hasEyebrowRow = Boolean(eyebrow || required);
  const titleMarginClass = hasEyebrowRow ? (compact ? "mt-1.5" : "mt-2") : "mt-0";

  return (
    <div className={align === "center" ? "text-center" : ""}>
      {hasEyebrowRow ? (
        <div className={align === "center" ? "flex justify-center" : "flex"}>
          <p className={`inline-flex items-center gap-2 font-semibold text-slate-500 ${compact ? "text-xs sm:text-sm" : "text-sm"}`}>
            {eyebrow}
            {required ? <span className="text-slate-400">Required</span> : null}
          </p>
        </div>
      ) : null}
      <h2 className={`${titleMarginClass} ${compact ? "text-lg sm:text-xl" : "text-2xl sm:text-3xl"} font-semibold leading-tight text-slate-950`}>
        {title}
      </h2>
      {body ? (
        <p className={`${compact ? "mt-2 hidden sm:block" : "mt-3"} ${mutedTextClass}`}>
          {body}
        </p>
      ) : null}
    </div>
  );
}

function TermsNote({ className = "" }: { className?: string }) {
  return (
    <p className={`${className} text-xs leading-5 text-slate-500 sm:text-sm sm:leading-6`}>
      By continuing, I agree to{" "}
      <a
        className="font-semibold text-slate-700 underline underline-offset-2"
        href="/terms"
        target="_blank"
        rel="noopener noreferrer"
      >
        terms
      </a>{" "}
      &{" "}
      <a
        className="font-semibold text-slate-700 underline underline-offset-2"
        href="/privacy"
        target="_blank"
        rel="noopener noreferrer"
      >
        privacy policy
      </a>
      .
    </p>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

function LoadingSlots() {
  return (
    <div className="grid gap-2 sm:grid-cols-2" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="h-14 rounded-md bg-slate-100" />
      ))}
    </div>
  );
}

function SlotPicker({
  groupedSlots,
  isLoading,
  onBookSlot,
  selectedSlot,
  timezone
}: {
  groupedSlots: Array<{ dateLabel: string; slots: SlotResponse["slots"] }>;
  isLoading: boolean;
  onBookSlot: (slot: SlotResponse["slots"][number]) => void | Promise<void>;
  selectedSlot: string | null;
  timezone: string;
}) {
  const timezoneLabel = formatTimezoneLabel(timezone);

  return (
    <div className="space-y-5">
      <StepHeading
        title="Choose the best time"
        body={`Times are shown in ${timezoneLabel}.`}
      />
      {isLoading ? (
        <div className="space-y-3" aria-live="polite">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Spinner />
            Loading availability
          </div>
          <LoadingSlots />
        </div>
      ) : (
        <div className="space-y-5">
          {groupedSlots.map((group) => (
            <div key={group.dateLabel} className="space-y-3">
              <h3 className="px-1 pt-3 text-xl font-bold leading-tight text-[var(--leadder-accent)] sm:text-2xl">
                {group.dateLabel}
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {group.slots.map((slot) => (
                  <button
                    key={slot.startTime}
                    type="button"
                    className={`${outlineButtonClass} min-h-14 justify-between text-left`}
                    disabled={selectedSlot === slot.startTime}
                    onClick={() => void onBookSlot(slot)}
                  >
                    <span className="font-semibold">{formatSlotTime(slot.startTime, timezone)}</span>
                    {selectedSlot === slot.startTime ? (
                      <Spinner />
                    ) : (
                      <span className="text-sm font-semibold text-slate-500">Book</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {!groupedSlots.length ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-5 text-sm leading-6 text-slate-600">
              No times are available right now. Please check back soon.
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Field({
  autoComplete,
  defaultValue,
  inputClassName = "",
  inputMode,
  label,
  name,
  placeholder,
  required = false,
  type = "text"
}: {
  autoComplete?: string;
  defaultValue?: string;
  inputClassName?: string;
  inputMode?: "decimal" | "email" | "numeric" | "search" | "tel" | "text" | "url";
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <div className="space-y-2">
      <label className={labelClass} htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        inputMode={inputMode}
        placeholder={placeholder}
        className={`${inputClass} ${inputClassName}`}
      />
    </div>
  );
}

function QuestionInput({
  compact = false,
  question,
  selectedStyle,
  value,
  onChange
}: {
  compact?: boolean;
  question: BookingQuestion;
  selectedStyle: CSSProperties;
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue) => void;
}) {
  if (question.question_type === "single_select") {
    const optionSizeClass = compact ? "min-h-12" : "min-h-14";
    return (
      <div className="grid gap-2">
        {question.options.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              className={
                selected
                  ? `${primaryButtonClass} ${optionSizeClass} justify-between text-left`
                  : `${outlineButtonClass} ${optionSizeClass} justify-between text-left hover:border-[var(--leadder-accent)] hover:bg-[var(--leadder-accent-soft)]`
              }
              style={selected ? selectedStyle : undefined}
              onClick={() => onChange(option.value)}
            >
              <span>{option.label}</span>
              <span className={selected ? "text-sm text-white/80" : "text-sm text-slate-400"}>
                {selected ? "Selected" : ""}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  if (question.question_type === "multi_select") {
    const selectedValues = Array.isArray(value) ? value : [];
    return (
      <div className="grid gap-2">
        {question.options.map((option) => {
          const selected = selectedValues.includes(option.value);
          return (
            <label
              key={option.value}
              className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-md border px-4 py-3 text-base font-semibold transition ${
                selected
                  ? "border-[var(--leadder-accent)] bg-[var(--leadder-accent-soft)] text-slate-950"
                  : "border-slate-200 bg-white text-slate-950 hover:border-[var(--leadder-accent)] hover:bg-[var(--leadder-accent-soft)]"
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={selected}
                onChange={(event) => {
                  onChange(
                    event.target.checked
                      ? [...selectedValues, option.value]
                      : selectedValues.filter((selectedValue) => selectedValue !== option.value)
                  );
                }}
              />
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-slate-300"
                style={selected ? selectedStyle : undefined}
                aria-hidden="true"
              >
                {selected ? <span className="h-2 w-2 rounded-sm bg-white" /> : null}
              </span>
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    );
  }

  const inputType =
    question.question_type === "phone"
      ? "tel"
      : question.question_type === "url"
        ? "text"
        : question.question_type === "number"
          ? "number"
          : question.question_type;
  const inputMode =
    question.question_type === "number"
      ? "decimal"
      : question.question_type === "phone"
        ? "tel"
        : question.question_type === "url"
          ? "url"
          : undefined;

  return (
    <input
      type={inputType}
      inputMode={inputMode}
      autoCapitalize={question.question_type === "url" ? "none" : undefined}
      autoCorrect={question.question_type === "url" ? "off" : undefined}
      value={Array.isArray(value) ? value.join(", ") : value ?? ""}
      className={inputClass}
      placeholder={question.placeholder ?? (question.question_type === "url" ? "company.com" : undefined)}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function groupSlotsByDate(slots: SlotResponse["slots"], timezone: string) {
  const groups: Array<{ dateLabel: string; slots: SlotResponse["slots"] }> = [];

  for (const slot of slots) {
    const dateLabel = formatSlotDate(slot.startTime, timezone);
    const existing = groups.find((group) => group.dateLabel === dateLabel);
    if (existing) {
      existing.slots.push(slot);
    } else {
      groups.push({ dateLabel, slots: [slot] });
    }
  }

  return groups;
}
