import { META_SEND_TIMEOUT_MS } from "@/lib/meta/constants";
import { buildMetaRequestBody, metaEventsUrl, type MetaServerEvent } from "@/lib/meta/payload";
import { summarizeMetaResponse, type MetaResponseSummary } from "@/lib/meta/response";

export type MetaSendResult = {
  ok: boolean;
  status: number | null;
  summary: MetaResponseSummary;
  error?: string;
};

/**
 * POST events to the Meta Conversions API.
 *
 * The access token travels in the JSON body (never the URL), and neither the
 * body nor the token is ever logged. If Meta refuses a token in the body on
 * release day (unverified point U1), switch this one place to an
 * `Authorization: Bearer` header.
 */
export async function postMetaEvents(input: {
  datasetId: string;
  accessToken: string;
  events: MetaServerEvent[];
  testEventCode?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<MetaSendResult> {
  const doFetch = input.fetchImpl ?? fetch;
  let url: string;
  try {
    url = metaEventsUrl(input.datasetId);
  } catch {
    return { ok: false, status: null, summary: {}, error: "Invalid pixel ID" };
  }

  try {
    const response = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildMetaRequestBody(input.events, input.accessToken, input.testEventCode)),
      signal: AbortSignal.timeout(META_SEND_TIMEOUT_MS),
      cache: "no-store"
    });
    const body: unknown = await response.json().catch(() => ({}));
    const summary = summarizeMetaResponse(body);
    return response.ok
      ? { ok: true, status: response.status, summary }
      : { ok: false, status: response.status, summary, error: summary.error?.message ?? `HTTP ${response.status}` };
  } catch (error) {
    const name = error instanceof Error && error.name ? error.name : "Error";
    return { ok: false, status: null, summary: {}, error: `Network error: ${name}` };
  }
}
