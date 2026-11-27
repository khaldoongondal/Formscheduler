/**
 * Small outbound HTTP helper shared by the vendor clients (rule 0: 10 second
 * timeout, no-store, JSON bodies, errors that never carry a token and at most
 * 200 characters of a response body). No Next.js or Supabase imports.
 */

export const PROVIDER_TIMEOUT_MS = 10_000;
const BODY_SNIPPET_CAP = 200;

export class ProviderHttpError extends Error {
  constructor(
    public provider: string,
    public status: number | null,
    public retryable: boolean,
    detail: string
  ) {
    super(`${provider} request failed${status === null ? "" : ` (${status})`}: ${detail}`.slice(0, 400));
    this.name = "ProviderHttpError";
  }
}

export function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/** Strips anything that looks like a bearer token or key before a body snippet goes into an error. */
export function redactSnippet(text: string): string {
  return text
    .replace(/(bearer\s+)[^\s"']+/gi, "$1[redacted]")
    .replace(/\b(cal_|pat-|ya29\.|1\/\/)[A-Za-z0-9._\-/]+/g, "[redacted]")
    .replace(/\s+/g, " ")
    .slice(0, BODY_SNIPPET_CAP);
}

export type ProviderRequest = {
  provider: string;
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  /** Sent as JSON. */
  json?: unknown;
  /** Sent as application/x-www-form-urlencoded. */
  form?: Record<string, string>;
  timeoutMs?: number;
};

export type ProviderResponse = { status: number; body: unknown };

/**
 * Returns the parsed body for 2xx. Throws ProviderHttpError for other statuses,
 * timeouts and network errors.
 */
export async function providerRequest(request: ProviderRequest): Promise<ProviderResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? PROVIDER_TIMEOUT_MS);
  const headers: Record<string, string> = { Accept: "application/json", ...(request.headers ?? {}) };
  let body: string | undefined;
  if (request.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(request.json);
  } else if (request.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(request.form).toString();
  }

  let response: Response;
  try {
    response = await fetch(request.url, {
      method: request.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      cache: "no-store",
      signal: controller.signal,
      redirect: "error"
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    throw new ProviderHttpError(request.provider, null, true, timedOut ? "timed out" : "network error");
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text().catch(() => "");
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!response.ok) {
    throw new ProviderHttpError(
      request.provider,
      response.status,
      isRetryableHttpStatus(response.status),
      redactSnippet(text) || "no body"
    );
  }
  return { status: response.status, body: parsed };
}
