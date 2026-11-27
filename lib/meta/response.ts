/**
 * Short, safe summaries of Meta responses for the event log.
 * Pure: no Next.js or Supabase imports. Never includes request data.
 */

const MAX_STRING = 300;
const MAX_MESSAGES = 5;

export type MetaResponseSummary = {
  events_received?: number;
  fbtrace_id?: string;
  messages?: string[];
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    is_transient?: boolean;
  };
};

function cap(value: unknown): string | undefined {
  return typeof value === "string" && value ? value.slice(0, MAX_STRING) : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function summarizeMetaResponse(body: unknown): MetaResponseSummary {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const source = body as Record<string, unknown>;
  const summary: MetaResponseSummary = {};

  const received = finiteNumber(source.events_received);
  if (received !== undefined) summary.events_received = received;
  const trace = cap(source.fbtrace_id);
  if (trace) summary.fbtrace_id = trace;
  if (Array.isArray(source.messages)) {
    const messages = source.messages
      .map((message) => (typeof message === "string" ? cap(message) : undefined))
      .filter((message): message is string => Boolean(message))
      .slice(0, MAX_MESSAGES);
    if (messages.length) summary.messages = messages;
  }

  const rawError = source.error;
  if (rawError && typeof rawError === "object" && !Array.isArray(rawError)) {
    const errorSource = rawError as Record<string, unknown>;
    const error: NonNullable<MetaResponseSummary["error"]> = {};
    const message = cap(errorSource.message);
    if (message) error.message = message;
    const type = cap(errorSource.type);
    if (type) error.type = type;
    const code = finiteNumber(errorSource.code);
    if (code !== undefined) error.code = code;
    const subcode = finiteNumber(errorSource.error_subcode);
    if (subcode !== undefined) error.error_subcode = subcode;
    if (typeof errorSource.is_transient === "boolean") error.is_transient = errorSource.is_transient;
    if (!summary.fbtrace_id) {
      const errorTrace = cap(errorSource.fbtrace_id);
      if (errorTrace) summary.fbtrace_id = errorTrace;
    }
    summary.error = error;
  } else if (typeof rawError === "string") {
    // Our own send layer reports network failures as a plain string.
    const message = cap(rawError);
    if (message) summary.error = { message };
  }

  return summary;
}

export function describeMetaResult(ok: boolean, status: number | null, summary: MetaResponseSummary): string {
  if (ok) {
    const count = summary.events_received ?? 1;
    return `Received by Meta (${count} ${count === 1 ? "event" : "events"})`;
  }
  if (status === null) return "Network error";
  const message = summary.error?.message;
  return message ? `HTTP ${status}: ${message}` : `HTTP ${status}`;
}
