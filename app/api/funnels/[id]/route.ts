import { NextRequest } from "next/server";
import { requireAdminApiUser } from "@/lib/auth/api";
import { getAdminTenantId } from "@/lib/auth/tenant";
import { fail, ok } from "@/lib/api/responses";
import { deleteFunnel, getFunnelById, updateFunnel } from "@/lib/funnels/service";
import { funnelDeleteBlocker } from "@/lib/split-tests/rules";
import { listSplitTestsUsingFunnel } from "@/lib/split-tests/service";

async function assertTenantAccess(id: string) {
  const tenantId = await getAdminTenantId();
  const funnel = await getFunnelById(id);
  if (!funnel || funnel.tenant_id !== tenantId) {
    throw new Error("Funnel not found.");
  }
  return tenantId;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
      await requireAdminApiUser(["owner", "admin"]);
    const { id } = await params;
    await assertTenantAccess(id);
    const body = (await request.json()) as Record<string, unknown>;
    return ok({ funnel: await updateFunnel({ ...body, id }) });
  } catch (error) {
    return fail(error, error instanceof Error && error.message === "Unauthorized" ? 401 : 400);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
      await requireAdminApiUser(["owner", "admin"]);
    const { id } = await params;
    const tenantId = await assertTenantAccess(id);
    // Deleting a form removes it from its split tests, so a running test blocks it.
    const blocker = funnelDeleteBlocker(await listSplitTestsUsingFunnel(tenantId, id));
    if (blocker) throw new Error(blocker);
    await deleteFunnel(id, tenantId);
    return ok({ deleted: true });
  } catch (error) {
    return fail(error, error instanceof Error && error.message === "Unauthorized" ? 401 : 400);
  }
}
