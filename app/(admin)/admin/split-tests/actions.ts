"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenantRole } from "@/lib/auth/tenant";
import {
  createSplitTest,
  deleteSplitTest,
  endSplitTest,
  renameSplitTest,
  setSplitTestWinner,
  startSplitTest,
  updateSplitTestDraft
} from "@/lib/split-tests/service";

const LIST_PATH = "/admin/split-tests";

function field(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function testFormInput(formData: FormData) {
  return {
    name: field(formData, "name"),
    slug: field(formData, "slug"),
    form_a: field(formData, "form_a"),
    form_b: field(formData, "form_b"),
    form_c: field(formData, "form_c")
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "Something went wrong. Please try again.";
}

function redirectWithError(path: string, error: unknown): never {
  redirect(`${path}?error=${encodeURIComponent(errorMessage(error))}`);
}

function detailPath(testId: string) {
  return `${LIST_PATH}/${encodeURIComponent(testId)}`;
}

/** A winner choice from the form: a form id, or empty for "keep splitting evenly". */
function winnerFromForm(formData: FormData): string | null {
  const value = field(formData, "winner_funnel_id");
  return value ? value : null;
}

async function adminTenantId() {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  return tenantId;
}

export async function createSplitTestAction(formData: FormData) {
  let testId: string;
  try {
    const tenantId = await adminTenantId();
    testId = await createSplitTest(tenantId, testFormInput(formData));
  } catch (error) {
    redirect(`${LIST_PATH}?error=${encodeURIComponent(errorMessage(error))}#create-test`);
  }
  revalidatePath(LIST_PATH);
  redirect(`${detailPath(testId)}?saved=created`);
}

export async function updateSplitTestAction(formData: FormData) {
  const testId = field(formData, "id");
  try {
    const tenantId = await adminTenantId();
    await updateSplitTestDraft(tenantId, testId, testFormInput(formData));
  } catch (error) {
    redirectWithError(detailPath(testId), error);
  }
  revalidatePath(LIST_PATH);
  redirect(`${detailPath(testId)}?saved=saved`);
}

export async function renameSplitTestAction(formData: FormData) {
  const testId = field(formData, "id");
  try {
    const tenantId = await adminTenantId();
    await renameSplitTest(tenantId, testId, field(formData, "name"));
  } catch (error) {
    redirectWithError(detailPath(testId), error);
  }
  revalidatePath(LIST_PATH);
  redirect(`${detailPath(testId)}?saved=saved`);
}

export async function startSplitTestAction(formData: FormData) {
  const testId = field(formData, "id");
  try {
    const tenantId = await adminTenantId();
    await startSplitTest(tenantId, testId);
  } catch (error) {
    redirectWithError(detailPath(testId), error);
  }
  revalidatePath(LIST_PATH);
  revalidatePath("/admin/funnels");
  redirect(`${detailPath(testId)}?saved=started`);
}

export async function endSplitTestAction(formData: FormData) {
  const testId = field(formData, "id");
  try {
    const tenantId = await adminTenantId();
    await endSplitTest(tenantId, testId, winnerFromForm(formData));
  } catch (error) {
    redirectWithError(detailPath(testId), error);
  }
  revalidatePath(LIST_PATH);
  revalidatePath("/admin/funnels");
  redirect(`${detailPath(testId)}?saved=ended`);
}

export async function setSplitTestWinnerAction(formData: FormData) {
  const testId = field(formData, "id");
  try {
    const tenantId = await adminTenantId();
    await setSplitTestWinner(tenantId, testId, winnerFromForm(formData));
  } catch (error) {
    redirectWithError(detailPath(testId), error);
  }
  revalidatePath(LIST_PATH);
  redirect(`${detailPath(testId)}?saved=winner`);
}

export async function deleteSplitTestAction(formData: FormData) {
  const testId = field(formData, "id");
  try {
    const tenantId = await adminTenantId();
    await deleteSplitTest(tenantId, testId);
  } catch (error) {
    redirectWithError(detailPath(testId), error);
  }
  revalidatePath(LIST_PATH);
  redirect(`${LIST_PATH}?saved=deleted`);
}
