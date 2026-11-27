/**
 * HubSpot as a CrmProvider (P3.4): contact upsert, optional deal, and a note
 * with the answers and tracking details. Ids found along the way go into
 * `updates` so a retry skips finished steps.
 */
import { ProviderHttpError } from "@/lib/connections/http";
import { getConnectionRowForTenant, markConnectionStatus, type ConnectionRow } from "@/lib/connections/service";
import type { CrmDeliveryOutcome, CrmLeadState, CrmProvider, FormBookEvent } from "@/lib/connections/types";
import {
  associateDefault,
  createContact,
  createDeal,
  createNote,
  listDealPipelines,
  probe,
  searchContactByPhone,
  updateContact,
  updateDealStage,
  upsertContactByEmail
} from "@/lib/hubspot/client";
import { HUBSPOT_COPY } from "@/lib/hubspot/constants";
import {
  contactProperties,
  dealName,
  dealPlan,
  hubspotOutcome,
  noteBody,
  parseHubspotSettings,
  type HubspotFormSettings,
  type HubspotPipeline
} from "@/lib/hubspot/mapping";
import { decryptSecret } from "@/lib/security/encryption";
import type { Funnel } from "@/lib/types/database";

export type HubspotCtx = { connectionId: string; token: string; settings: HubspotFormSettings; dealTemplate: string };

/** Null when no token is stored. A form that is gone still gets contacts and notes (no deals). */
export function hubspotContext(row: ConnectionRow, funnel: Funnel | null): HubspotCtx | null {
  if (row.provider !== "hubspot" || !row.secret_ciphertext) return null;
  return {
    connectionId: row.id,
    token: decryptSecret(row.secret_ciphertext),
    settings: parseHubspotSettings(funnel?.crm_settings),
    dealTemplate: funnel?.opportunity_name_template || "{{lead_name}}"
  };
}

function statusOf(error: unknown): number | null {
  return error instanceof ProviderHttpError ? error.status : null;
}

async function resolveContact(ctx: HubspotCtx, event: FormBookEvent, lead: CrmLeadState): Promise<string> {
  const properties = contactProperties(event.lead);
  if (lead.crmContactId) {
    try {
      await updateContact(ctx.token, lead.crmContactId, properties);
      return lead.crmContactId;
    } catch (error) {
      // A contact deleted in HubSpot is found or created again below.
      if (statusOf(error) !== 404) throw error;
    }
  }
  if (properties.email) {
    const id = await upsertContactByEmail(ctx.token, properties.email, properties);
    if (id) return id;
  }
  if (properties.phone) {
    const found = await searchContactByPhone(ctx.token, properties.phone);
    if (found) {
      await updateContact(ctx.token, found, properties);
      return found;
    }
  }
  return createContact(ctx.token, properties);
}

async function onAuthFailure(ctx: HubspotCtx, status: number | null) {
  if (status !== 401 && status !== 403) return;
  const message = status === 401 ? HUBSPOT_COPY.tokenNoLongerAccepted : HUBSPOT_COPY.scopeMissingRuntime;
  await markConnectionStatus(ctx.connectionId, "needs_attention", message).catch(() => {
    console.error("[hubspot] status update failed");
  });
}

export async function deliverToHubspot(ctx: HubspotCtx, event: FormBookEvent, lead: CrmLeadState): Promise<CrmDeliveryOutcome> {
  if (event.type === "test.ping") return { outcome: "sent", httpStatus: null, summary: HUBSPOT_COPY.checkOk };
  const updates: NonNullable<CrmDeliveryOutcome["updates"]> = {};
  let step = "contact";
  try {
    const contactId = await resolveContact(ctx, event, lead);
    if (contactId !== lead.crmContactId) updates.crmContactId = contactId;

    step = "deal";
    let dealId = lead.crmDealId;
    let dealSummary = "No deal.";
    let plan = dealPlan(event, ctx.settings, Boolean(dealId));
    if (plan.action === "move" && dealId) {
      try {
        await updateDealStage(ctx.token, dealId, plan.stageId);
        dealSummary = "Deal moved.";
      } catch (error) {
        if (statusOf(error) !== 404) throw error;
        // The deal was deleted in HubSpot: plan again as if there was none.
        dealId = null;
        plan = dealPlan(event, ctx.settings, false);
      }
    }
    if (plan.action === "create" && ctx.settings.pipeline_id) {
      dealId = await createDeal(ctx.token, {
        name: dealName(ctx.dealTemplate, event),
        pipelineId: ctx.settings.pipeline_id,
        stageId: plan.stageId
      });
      updates.crmDealId = dealId;
      await associateDefault(ctx.token, "deals", dealId, "contacts", contactId);
      dealSummary = "Deal created.";
    }

    step = "note";
    const noteId = await createNote(ctx.token, { timestamp: event.created_at, body: noteBody(event) });
    await associateDefault(ctx.token, "notes", noteId, "contacts", contactId);
    if (dealId) await associateDefault(ctx.token, "notes", noteId, "deals", dealId);

    return { outcome: "sent", httpStatus: 200, summary: `Contact ${contactId} updated. ${dealSummary} Note added.`, updates };
  } catch (error) {
    const status = statusOf(error);
    await onAuthFailure(ctx, status);
    const outcome = error instanceof ProviderHttpError ? hubspotOutcome(status) : "retry";
    const reason = status === null ? (error instanceof Error ? error.name : "error") : `HTTP ${status}`;
    return { outcome, httpStatus: status, summary: `HubSpot ${step} step failed: ${reason}.`, updates };
  }
}

export const hubspotCrmProvider: CrmProvider<HubspotCtx> = {
  kind: "hubspot",
  deliver: (ctx, event, lead) => deliverToHubspot(ctx, event, lead)
};

/** Fixed messages for the create and replace forms. */
export async function verifyHubspotToken(token: string): Promise<void> {
  try {
    await probe(token);
  } catch (error) {
    const status = statusOf(error);
    if (status === 401) throw new Error(HUBSPOT_COPY.tokenRejected);
    if (status === 403) throw new Error(HUBSPOT_COPY.tokenMissingScope);
    console.error("[hubspot] token check failed", status ?? "unknown");
    throw new Error(HUBSPOT_COPY.tokenCheckFailed);
  }
}

export async function checkHubspotConnection(row: ConnectionRow): Promise<{ ok: boolean; summary: string }> {
  if (!row.secret_ciphertext) return { ok: false, summary: HUBSPOT_COPY.tokenNoLongerAccepted };
  try {
    await probe(decryptSecret(row.secret_ciphertext));
    return { ok: true, summary: HUBSPOT_COPY.checkOk };
  } catch (error) {
    const status = statusOf(error);
    if (status === 401 || status === 403) {
      const message = status === 401 ? HUBSPOT_COPY.tokenNoLongerAccepted : HUBSPOT_COPY.scopeMissingRuntime;
      await markConnectionStatus(row.id, "needs_attention", message).catch(() => undefined);
      return { ok: false, summary: message };
    }
    return { ok: false, summary: HUBSPOT_COPY.checkFailed };
  }
}

export type HubspotPipelinesResult = { ok: true; pipelines: HubspotPipeline[] } | { ok: false };

/** Deal pipelines of a tenant's own HubSpot connection (editor picker and save re-validation, C23). */
export async function loadHubspotPipelines(tenantId: string, connectionId: string): Promise<HubspotPipelinesResult> {
  try {
    const row = await getConnectionRowForTenant(tenantId, connectionId);
    if (!row || row.provider !== "hubspot" || !row.secret_ciphertext) return { ok: false };
    return { ok: true, pipelines: await listDealPipelines(decryptSecret(row.secret_ciphertext)) };
  } catch (error) {
    console.error("[hubspot] pipelines failed", statusOf(error) ?? "unknown");
    return { ok: false };
  }
}
