"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminActorEmail, requireTenantRole } from "@/lib/auth/tenant";
import { fireAllHeld, fireHeldForLead, sendTestEvent, updatePixelSending } from "@/lib/meta/controls";
import { parseSendingInput } from "@/lib/meta/log-format";
import { createPixel, deletePixel, getPixel, updatePixel } from "@/lib/meta/pixels";
import { getClientIp } from "@/lib/security/client-ip";

const LIST_PATH = "/admin/pixels";

function field(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "Something went wrong. Please try again.";
}

function detailPath(pixelId: string) {
  return `${LIST_PATH}/${encodeURIComponent(pixelId)}`;
}

function pixelInput(formData: FormData) {
  return {
    name: field(formData, "name"),
    dataset_id: field(formData, "dataset_id"),
    access_token: field(formData, "access_token"),
    test_event_code: field(formData, "test_event_code")
  };
}

async function adminTenantId() {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  return tenantId;
}

export async function createPixelAction(formData: FormData) {
  let pixelId: string;
  try {
    const tenantId = await adminTenantId();
    pixelId = await createPixel(tenantId, pixelInput(formData));
  } catch (error) {
    redirect(`${LIST_PATH}?error=${encodeURIComponent(errorMessage(error))}#add-pixel`);
  }
  revalidatePath(LIST_PATH);
  redirect(`${detailPath(pixelId)}?saved=created`);
}

export async function updatePixelAction(formData: FormData) {
  const pixelId = field(formData, "id");
  try {
    const tenantId = await adminTenantId();
    await updatePixel(tenantId, pixelId, pixelInput(formData));
  } catch (error) {
    redirect(`${detailPath(pixelId)}?error=${encodeURIComponent(errorMessage(error))}`);
  }
  revalidatePath(LIST_PATH);
  redirect(`${detailPath(pixelId)}?saved=saved`);
}

export async function deletePixelAction(formData: FormData) {
  const pixelId = field(formData, "id");
  try {
    const tenantId = await adminTenantId();
    await deletePixel(tenantId, pixelId);
  } catch (error) {
    redirect(`${detailPath(pixelId)}?error=${encodeURIComponent(errorMessage(error))}`);
  }
  revalidatePath(LIST_PATH);
  revalidatePath("/admin/funnels");
  redirect(`${LIST_PATH}?saved=deleted`);
}

function returnPath(formData: FormData, pixelId: string) {
  // Only our own pixel pages are allowed as a return address.
  const requested = field(formData, "return_to");
  const base = detailPath(pixelId);
  return requested === `${base}/events` ? requested : base;
}

export async function savePixelSendingAction(formData: FormData) {
  const pixelId = field(formData, "id");
  try {
    const tenantId = await adminTenantId();
    await updatePixelSending(tenantId, pixelId, parseSendingInput(Object.fromEntries(formData.entries())));
  } catch (error) {
    redirect(`${detailPath(pixelId)}?error=${encodeURIComponent(errorMessage(error))}#sending`);
  }
  revalidatePath(detailPath(pixelId));
  redirect(`${detailPath(pixelId)}?saved=sending#sending`);
}

export async function fireAllHeldAction(formData: FormData) {
  const pixelId = field(formData, "id");
  const back = returnPath(formData, pixelId);
  let fired = 0;
  try {
    const { tenantId } = await requireTenantRole(["owner", "admin"]);
    const actor = await getAdminActorEmail();
    fired = await fireAllHeld(tenantId, pixelId, actor);
  } catch (error) {
    redirect(`${back}?error=${encodeURIComponent(errorMessage(error))}`);
  }
  revalidatePath(detailPath(pixelId));
  redirect(`${back}?saved=${fired > 0 ? "fired" : "nothing-held"}&n=${fired}`);
}

/** The "Send" button on a held row of the event log: fires that row's lead, else every held row of the pixel. */
export async function fireLogRowAction(formData: FormData) {
  const pixelId = field(formData, "id");
  const leadSessionId = field(formData, "lead_session_id");
  const back = `${detailPath(pixelId)}/events`;
  let fired = 0;
  try {
    const { tenantId } = await requireTenantRole(["owner", "admin"]);
    const actor = await getAdminActorEmail();
    if (leadSessionId) {
      // The pixel id in the form is checked too, so a row can only be fired from its own pixel's log.
      if (!(await getPixel(tenantId, pixelId))) throw new Error("Not found.");
      fired = await fireHeldForLead(tenantId, leadSessionId, actor);
    } else {
      fired = await fireAllHeld(tenantId, pixelId, actor);
    }
  } catch (error) {
    redirect(`${back}?error=${encodeURIComponent(errorMessage(error))}`);
  }
  revalidatePath(back);
  redirect(`${back}?saved=${fired > 0 ? "fired" : "nothing-held"}&n=${fired}`);
}

export async function sendTestEventAction(formData: FormData) {
  const pixelId = field(formData, "id");
  let result: { ok: boolean; message: string };
  try {
    const tenantId = await adminTenantId();
    const requestHeaders = await headers();
    result = await sendTestEvent(tenantId, pixelId, {
      ip: getClientIp(requestHeaders),
      userAgent: (requestHeaders.get("user-agent") ?? "").slice(0, 512)
    });
  } catch (error) {
    redirect(`${detailPath(pixelId)}?error=${encodeURIComponent(errorMessage(error))}#test`);
  }
  revalidatePath(detailPath(pixelId));
  redirect(
    result.ok ? `${detailPath(pixelId)}?saved=test-ok#test` : `${detailPath(pixelId)}?test_error=${encodeURIComponent(result.message)}#test`
  );
}
