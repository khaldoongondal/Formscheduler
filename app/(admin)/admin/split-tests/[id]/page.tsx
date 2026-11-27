import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Link2, Play, Rows3, Square } from "lucide-react";
import {
  deleteSplitTestAction,
  endSplitTestAction,
  renameSplitTestAction,
  setSplitTestWinnerAction,
  startSplitTestAction,
  updateSplitTestAction
} from "@/app/(admin)/admin/split-tests/actions";
import {
  ActionError,
  ActionSuccess,
  SplitTestFields,
  StatusBadge,
  formatDate,
  selectClass,
  type FormChoice
} from "@/app/(admin)/admin/split-tests/split-test-ui";
import { ConfirmDeleteButton } from "@/components/admin/confirm-delete-button";
import { CopySnippetButton } from "@/components/admin/copy-snippet-button";
import { SaveSubmitButton } from "@/components/admin/save-submit-button";
import { SetupRequired } from "@/components/setup/setup-required";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAdminTenantId } from "@/lib/auth/tenant";
import { buildIframeSnippet, buildPopupSnippet } from "@/lib/embed/snippets";
import { getMissingSupabaseAdminEnv } from "@/lib/env";
import { listFunnels } from "@/lib/funnels/service";
import { splitArmLabel } from "@/lib/split-tests/assignment";
import {
  SPLIT_TEST_COPY,
  SPLIT_TEST_SAVED_MESSAGES,
  unavailableMemberWarning
} from "@/lib/split-tests/rules";
import { getRunningTestsByFunnel, getSplitTest, type SplitTestWithMembers } from "@/lib/split-tests/service";

export const dynamic = "force-dynamic";

export default async function SplitTestDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
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
  const test = await getSplitTest(tenantId, id);
  if (!test) notFound();

  const query = searchParams ? await searchParams : {};
  const actionError = typeof query.error === "string" ? query.error : null;
  const actionSuccess = query.saved ? SPLIT_TEST_SAVED_MESSAGES[query.saved] ?? null : null;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const pageUrl = `${baseUrl}/t/${test.slug}`;
  const embedUrl = `${baseUrl}/embed/t/${test.slug}`;
  const members = [...test.members].sort((left, right) => left.position - right.position);
  const isLive = test.status !== "draft";
  const unavailable = members.filter((member) => !member.isPublished || member.takenDown);
  const noneAvailable = members.length > 0 && unavailable.length === members.length;

  return (
    <div className="space-y-8">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3 mb-3">
          <Link href="/admin/split-tests">
            <ArrowLeft className="h-4 w-4" />
            All split tests
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{test.name}</h1>
          <StatusBadge status={test.status} />
        </div>
        <p className="mt-2 text-sm text-slate-600">
          /t/{test.slug}
          {test.started_at ? ` | Started ${formatDate(test.started_at)}` : ""}
          {test.ended_at ? ` | Ended ${formatDate(test.ended_at)}` : ""}
        </p>
      </div>

      {actionError ? <ActionError message={actionError} /> : null}
      {actionSuccess ? <ActionSuccess message={actionSuccess} /> : null}

      {isLive && noneAvailable ? <Warning message={SPLIT_TEST_COPY.noActiveMember} /> : null}
      {isLive && !noneAvailable
        ? unavailable.map((member) => <Warning key={member.funnelId} message={unavailableMemberWarning(member.name)} />)
        : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-primary" />
            Test link
          </CardTitle>
          <CardDescription>{isLive ? SPLIT_TEST_COPY.linkNote : SPLIT_TEST_COPY.draftLinkNote}</CardDescription>
        </CardHeader>
        <CardContent>
          <section className="grid gap-4 xl:grid-cols-3">
            <Snippet label="Full page" value={pageUrl} />
            <Snippet label="Iframe" value={buildIframeSnippet(embedUrl)} />
            <Snippet label="Popup" value={buildPopupSnippet(embedUrl)} />
          </section>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Rows3 className="h-5 w-5 text-primary" />
            Forms
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {members.map((member) => (
              <li key={member.funnelId} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 font-semibold text-slate-700">
                  {splitArmLabel(member.position)}
                </span>
                <Link href={`/admin/funnels/${member.funnelId}`} className="font-semibold text-slate-950 hover:underline">
                  {member.name}
                </Link>
                <FormStatus isPublished={member.isPublished} takenDown={member.takenDown} />
                {test.winner_funnel_id === member.funnelId ? (
                  <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">Winner</span>
                ) : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {test.status === "draft" ? <DraftControls test={test} tenantId={tenantId} baseUrl={baseUrl} /> : null}
      {test.status === "running" ? <RunningControls test={test} members={members} /> : null}
      {test.status === "ended" ? <EndedControls test={test} members={members} /> : null}
    </div>
  );
}

async function DraftControls({
  test,
  tenantId,
  baseUrl
}: {
  test: SplitTestWithMembers;
  tenantId: string;
  baseUrl: string;
}) {
  const [funnels, runningByFunnel] = await Promise.all([listFunnels(tenantId), getRunningTestsByFunnel(tenantId)]);
  const choices: FormChoice[] = funnels.map((funnel) => {
    const running = runningByFunnel.get(funnel.id);
    return {
      id: funnel.id,
      name: funnel.name,
      isPublished: funnel.is_published,
      takenDown: Boolean(funnel.taken_down_at),
      runningTestName: running && running.id !== test.id ? running.name : null
    };
  });
  const formIds = [...test.members].sort((left, right) => left.position - right.position).map((member) => member.funnelId);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Edit test</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updateSplitTestAction} className="space-y-5">
            <input type="hidden" name="id" value={test.id} />
            <SplitTestFields
              baseUrl={baseUrl}
              choices={choices}
              idPrefix="edit"
              defaults={{ name: test.name, slug: test.slug, formIds }}
            />
            <SaveSubmitButton label="Save changes" />
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Start or delete</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <details className="group max-w-xl">
            <summary className="inline-flex h-10 cursor-pointer list-none items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              <Play className="h-4 w-4" />
              Start test
            </summary>
            <form action={startSplitTestAction} className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <input type="hidden" name="id" value={test.id} />
              <p className="text-sm leading-6 text-slate-700">{SPLIT_TEST_COPY.startConfirm}</p>
              <SaveSubmitButton label="Yes, start the test" pendingLabel="Starting..." />
            </form>
          </details>
          <form action={deleteSplitTestAction}>
            <input type="hidden" name="id" value={test.id} />
            <ConfirmDeleteButton
              label="Delete test"
              title="Delete this test?"
              description={SPLIT_TEST_COPY.deleteConfirm}
              variant="outline"
            />
          </form>
        </CardContent>
      </Card>
    </>
  );
}

function NameForm({ test }: { test: SplitTestWithMembers }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Name</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={renameSplitTestAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <input type="hidden" name="id" value={test.id} />
          <div className="w-full max-w-md space-y-2">
            <Label htmlFor="rename-name">Name</Label>
            <Input id="rename-name" name="name" required maxLength={120} defaultValue={test.name} />
          </div>
          <SaveSubmitButton label="Save changes" />
        </form>
      </CardContent>
    </Card>
  );
}

function RunningControls({
  test,
  members
}: {
  test: SplitTestWithMembers;
  members: SplitTestWithMembers["members"];
}) {
  return (
    <>
      <NameForm test={test} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Square className="h-5 w-5 text-primary" />
            End test
          </CardTitle>
          <CardDescription>{SPLIT_TEST_COPY.endHelper}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={endSplitTestAction} className="space-y-4">
            <input type="hidden" name="id" value={test.id} />
            <fieldset className="grid gap-3 md:grid-cols-2">
              <legend className="sr-only">After the test ends</legend>
              <RadioOption name="winner_funnel_id" value="" label="Keep splitting evenly" defaultChecked />
              {members.map((member) => (
                <RadioOption
                  key={member.funnelId}
                  name="winner_funnel_id"
                  value={member.funnelId}
                  label={`Send everyone to ${member.name}`}
                />
              ))}
            </fieldset>
            <SaveSubmitButton label="End test" pendingLabel="Ending..." />
          </form>
        </CardContent>
      </Card>
    </>
  );
}

function EndedControls({
  test,
  members
}: {
  test: SplitTestWithMembers;
  members: SplitTestWithMembers["members"];
}) {
  return (
    <>
      <NameForm test={test} />
      <Card>
        <CardHeader>
          <CardTitle>Winner</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={setSplitTestWinnerAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <input type="hidden" name="id" value={test.id} />
            <div className="w-full max-w-md space-y-2">
              <Label htmlFor="winner">Winner</Label>
              <select id="winner" name="winner_funnel_id" className={selectClass} defaultValue={test.winner_funnel_id ?? ""}>
                <option value="">No winner, keep splitting evenly</option>
                {members.map((member) => (
                  <option key={member.funnelId} value={member.funnelId}>
                    {member.name}
                  </option>
                ))}
              </select>
            </div>
            <SaveSubmitButton label="Save" />
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Delete</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={deleteSplitTestAction}>
            <input type="hidden" name="id" value={test.id} />
            <ConfirmDeleteButton
              label="Delete test"
              title="Delete this test?"
              description={SPLIT_TEST_COPY.deleteConfirm}
              variant="destructive"
            />
          </form>
        </CardContent>
      </Card>
    </>
  );
}

function RadioOption({
  name,
  value,
  label,
  defaultChecked = false
}: {
  name: string;
  value: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm transition hover:border-slate-300 hover:bg-slate-50">
      <input type="radio" name={name} value={value} defaultChecked={defaultChecked} className="mt-1" />
      <span className="font-semibold text-slate-950">{label}</span>
    </label>
  );
}

function Warning({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{message}</p>
    </div>
  );
}

function FormStatus({ isPublished, takenDown }: { isPublished: boolean; takenDown: boolean }) {
  if (takenDown) {
    return <span className="rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">Taken down</span>;
  }
  return (
    <span
      className={
        isPublished
          ? "rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700"
          : "rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600"
      }
    >
      {isPublished ? "Active" : "Draft"}
    </span>
  );
}

function Snippet({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-800">{label}</p>
        <CopySnippetButton label={label} value={value} />
      </div>
      <pre className="max-h-32 overflow-x-auto rounded-md bg-slate-950 p-3 text-xs leading-5 text-white">{value}</pre>
    </div>
  );
}
