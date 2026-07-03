import Link from "next/link";
import { ArrowRight, CheckCircle2, ExternalLink, Plus } from "lucide-react";
import { createFunnelAction } from "@/app/(admin)/admin/funnels/actions";
import { getAdminTenantId } from "@/lib/auth/tenant";
import { getMissingSupabaseAdminEnv } from "@/lib/env";
import { listFunnels } from "@/lib/funnels/service";
import { SetupRequired } from "@/components/setup/setup-required";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const dynamic = "force-dynamic";

export default async function FunnelsPage({
  searchParams
}: {
  searchParams?: Promise<{ create?: string; error?: string; saved?: string }>;
}) {
  const missingEnv = getMissingSupabaseAdminEnv();
  if (missingEnv.length > 0) {
    return (
      <SetupRequired
        title="Supabase is required for the admin dashboard."
        description="The admin dashboard reads tenant membership, funnels, GHL connections, and analytics from Supabase. The static homepage can load without these values, but admin pages cannot."
        missingEnv={missingEnv}
      />
    );
  }

  const tenantId = await getAdminTenantId();
  const funnels = await listFunnels(tenantId);
  const query = searchParams ? await searchParams : {};
  const actionError = typeof query.error === "string" ? query.error : null;
  const actionSuccess = query.saved === "deleted" ? "Funnel deleted." : null;
  const showCreateForm = query.create === "1" || funnels.length === 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold text-emerald-700">Funnels</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Booking funnels</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Choose a funnel to manage its questions, GHL handoff, theme, booking links, and performance.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin/funnels?create=1#create-funnel">
            <Plus className="h-4 w-4" />
            New funnel
          </Link>
        </Button>
      </div>

      {actionError ? <ActionError message={actionError} /> : null}
      {actionSuccess ? <ActionSuccess message={actionSuccess} /> : null}

      {showCreateForm ? <CreateFunnelCard canCancel={funnels.length > 0} /> : null}

      <section className="grid gap-4">
        {funnels.map((funnel) => (
          <article
            key={funnel.id}
            className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md"
          >
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-slate-950">{funnel.name}</h2>
                  <StatusBadge published={funnel.is_published} />
                </div>
                <p className="mt-1 text-sm text-slate-500">/{funnel.slug}</p>
                {funnel.description ? (
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">{funnel.description}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {funnel.is_published ? (
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/book/${funnel.slug}`} target="_blank">
                      <ExternalLink className="h-4 w-4" />
                      Preview
                    </Link>
                  </Button>
                ) : null}
                <Button asChild size="sm">
                  <Link href={`/admin/funnels/${funnel.id}`}>
                    Manage
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </article>
        ))}

        {funnels.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <h2 className="text-lg font-semibold text-slate-950">No funnels yet</h2>
              <p className="mt-2 text-sm text-slate-600">Create your first booking funnel, then configure its flow and GHL handoff.</p>
            </CardContent>
          </Card>
        ) : null}
      </section>
    </div>
  );
}

function CreateFunnelCard({ canCancel }: { canCancel: boolean }) {
  return (
    <Card id="create-funnel" className="max-w-3xl scroll-mt-24">
        <CardHeader>
          <CardTitle>Create funnel</CardTitle>
          <CardDescription>Start with the essentials. Theme, GHL, questions, and analytics live inside the funnel workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createFunnelAction} className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Public title</Label>
                <Input id="name" name="name" required placeholder="Growth Strategy Consultation" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slug">URL slug</Label>
                <Input id="slug" name="slug" required placeholder="growth-strategy-call" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Top-left description</Label>
              <Textarea
                id="description"
                name="description"
                placeholder="Book your 20-min discovery meeting today."
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit">
                <Plus className="h-4 w-4" />
                Create draft funnel
              </Button>
              {canCancel ? (
                <Button asChild type="button" variant="ghost">
                  <Link href="/admin/funnels">Cancel</Link>
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>
  );
}

function ActionError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
      <p className="font-semibold">This setting was not saved.</p>
      <p>{message}</p>
    </div>
  );
}

function ActionSuccess({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="font-semibold">{message}</p>
    </div>
  );
}

function StatusBadge({ published }: { published: boolean }) {
  return (
    <span
      className={
        published
          ? "rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700"
          : "rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600"
      }
    >
      {published ? "Published" : "Draft"}
    </span>
  );
}
