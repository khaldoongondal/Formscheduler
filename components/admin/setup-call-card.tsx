import { CalendarCheck } from "lucide-react";
import { dismissSetupCallAction } from "@/app/(admin)/admin/onboarding-actions";
import { SETUP_CALL_COPY, type SetupCallMoment } from "@/lib/onboarding/checklist";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Free setup-call card (decision D19). Renders nothing when there is no moment to show it. */
export function SetupCallCard({
  moment,
  url,
  returnTo
}: {
  moment: SetupCallMoment | null;
  url: string | null;
  returnTo: "/admin/funnels" | "/admin/welcome";
}) {
  if (!moment || !url) return null;
  const copy = SETUP_CALL_COPY[moment];
  return (
    <Card>
      <CardHeader>
        <div className="mb-1 flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
          <CalendarCheck className="h-5 w-5" aria-hidden="true" />
        </div>
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.body}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <Button asChild variant="outline">
          <a href={url} target="_blank" rel="noopener noreferrer">
            {copy.cta}
          </a>
        </Button>
        <form action={dismissSetupCallAction}>
          <input type="hidden" name="return_to" value={returnTo} />
          <Button type="submit" variant="ghost">
            {SETUP_CALL_COPY.dismiss}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
