import Link from "next/link";
import { createSplitTestAction } from "@/app/(admin)/admin/split-tests/actions";
import {
  ActionError,
  ActionSuccess,
  SplitTestFields,
  StatusBadge,
  formatDate,
  type FormChoice
} from "@/app/(admin)/admin/split-tests/split-test-ui";
import { SaveSubmitButton } from "@/components/admin/save-submit-button";
import { SetupRequired } from "@/components/setup/setup-required";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAdminTenantId } from "@/lib/auth/tenant";
import { getMissingSupabaseAdminEnv } from "@/lib/env";
import { listFunnels } from "@/lib/funnels/service";
import { SPLIT_TEST_COPY, SPLIT_TEST_SAVED_MESSAGES } from "@/lib/split-tests/rules";
import { getRunningTestsByFunnel, listSplitTests } from "@/lib/split-tests/service";

export const dynamic = "force-dynamic";

export default async function SplitTestsPage({
  searchParams
}: {
  searchParams?: Promise<{ error?: string; saved?: string }>;
}) {
  const missingEnv = getMissingSupabaseAdminEnv();
  if (missingEnv.length > 0) {
    return (
      <SetupRequired
        title="Supabase is required for split tests."
        description="Split tests, their forms and their links are stored in Supabase. Add the database environment variables before opening this page."
        missingEnv={missingEnv}
      />
    );
  }

  const tenantId = await getAdminTenantId();
  const [tests, funnels, runningByFunnel] = await Promise.all([
    listSplitTests(tenantId),
    listFunnels(tenantId),
    getRunningTestsByFunnel(tenantId)
  ]);
  const query = searchParams ? await searchParams : {};
  const actionError = typeof query.error === "string" ? query.error : null;
  const actionSuccess =
    query.saved === "deleted" ? "Split test deleted." : query.saved ? SPLIT_TEST_SAVED_MESSAGES[query.saved] ?? null : null;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const choices: FormChoice[] = funnels.map((funnel) => ({
    id: funnel.id,
    name: funnel.name,
    isPublished: funnel.is_published,
    takenDown: Boolean(funnel.taken_down_at),
    runningTestName: runningByFunnel.get(funnel.id)?.name ?? null
  }));

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm font-semibold text-emerald-700">Split Tests</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{SPLIT_TEST_COPY.listHeading}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{SPLIT_TEST_COPY.listSubheading}</p>
      </div>

      {actionError ? <ActionError message={actionError} /> : null}
      {actionSuccess ? <ActionSuccess message={actionSuccess} /> : null}

      {tests.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-slate-600">{SPLIT_TEST_COPY.empty}</CardContent>
        </Card>
      ) : (
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="hidden w-full text-left text-sm md:table">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Forms</th>
                <th className="px-4 py-3">Started</th>
                <th className="px-4 py-3">Ended</th>
              </tr>
            </thead>
            <tbody>
              {tests.map((test) => (
                <tr key={test.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <Link href={`/admin/split-tests/${test.id}`} className="font-semibold text-slate-950 hover:underline">
                      {test.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={test.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">{test.members.map((member) => member.name).join(" vs ")}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(test.started_at) ?? "Not started"}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(test.ended_at) ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="divide-y divide-slate-100 md:hidden">
            {tests.map((test) => (
              <li key={test.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/admin/split-tests/${test.id}`} className="font-semibold text-slate-950 hover:underline">
                    {test.name}
                  </Link>
                  <StatusBadge status={test.status} />
                </div>
                <p className="text-sm text-slate-600">{test.members.map((member) => member.name).join(" vs ")}</p>
                <p className="text-xs text-slate-500">
                  Started: {formatDate(test.started_at) ?? "Not started"}
                  {test.ended_at ? ` | Ended: ${formatDate(test.ended_at)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Card id="create-test" className="max-w-4xl scroll-mt-24">
        <CardHeader>
          <CardTitle>{SPLIT_TEST_COPY.createTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createSplitTestAction} className="space-y-5">
            <SplitTestFields baseUrl={baseUrl} choices={choices} idPrefix="create" />
            <SaveSubmitButton label="Create test" pendingLabel="Creating..." />
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
