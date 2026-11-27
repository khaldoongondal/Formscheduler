"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenantRole } from "@/lib/auth/tenant";
import { onboardingReturnPath } from "@/lib/onboarding/checklist";
import { markOnboarding, type OnboardingField } from "@/lib/onboarding/service";

async function markAndReturn(formData: FormData, field: OnboardingField, clear = false): Promise<never> {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  await markOnboarding(tenantId, field, clear);
  revalidatePath("/admin/funnels");
  revalidatePath("/admin/welcome");
  redirect(onboardingReturnPath(formData.get("return_to")));
}

export async function hideChecklistAction(formData: FormData) {
  await markAndReturn(formData, "checklist_hidden_at");
}

export async function showChecklistAction(formData: FormData) {
  await markAndReturn(formData, "checklist_hidden_at", true);
}

export async function dismissSetupCallAction(formData: FormData) {
  await markAndReturn(formData, "setup_call_dismissed_at");
}

/** Called by the editor's copy buttons after a successful copy. No input, no redirect. */
export async function markEmbedCopiedAction(): Promise<void> {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  await markOnboarding(tenantId, "embed_copied_at");
}
