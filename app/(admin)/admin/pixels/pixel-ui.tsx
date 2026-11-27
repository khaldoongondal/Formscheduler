import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const PIXEL_COPY = {
  heading: "Meta Pixels",
  subheading:
    "Send form events to Meta from our server with the Conversions API. Paste a pixel ID and an access token from Meta Events Manager. Meta is only contacted for forms that use a pixel.",
  addTitle: "Add a pixel",
  nameHelp: "For you only, like Main ads account.",
  datasetHelp: "The number shown in Events Manager under Data sources.",
  tokenHelp:
    "In Events Manager open your pixel, then Settings, then Conversions API, and generate an access token. We store it encrypted and only show the last four characters.",
  testCodeHelp:
    "From the Test events tab in Events Manager. While it is set, every event is sent with this code so you can watch it arrive. Remove it when you finish testing.",
  deleteConfirm:
    "Deleting this pixel stops Meta events for every form that uses it and deletes its event log. This cannot be undone.",
  empty: "No Meta pixels yet. Add one below."
} as const;

export const PIXEL_SAVED_MESSAGES: Record<string, string> = {
  created: "Pixel added.",
  saved: "Pixel saved.",
  deleted: "Pixel deleted."
};

export function usageLine(count: number, max: number, planName: string) {
  return `Meta pixels: ${count} of ${max} on the ${planName} plan.`;
}

/** Name, pixel ID, token and test event code, shared by the add and edit forms. */
export function PixelFields({
  idPrefix,
  defaults,
  tokenLastFour
}: {
  idPrefix: string;
  defaults?: { name: string; datasetId: string; testEventCode: string | null };
  /** Set on the edit form: a blank token keeps the saved one. */
  tokenLastFour?: string | null;
}) {
  const editing = Boolean(defaults);
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-name`}>Name</Label>
        <Input id={`${idPrefix}-name`} name="name" required maxLength={80} defaultValue={defaults?.name ?? ""} />
        <p className="text-xs leading-5 text-slate-500">{PIXEL_COPY.nameHelp}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-dataset`}>Pixel or dataset ID</Label>
        <Input
          id={`${idPrefix}-dataset`}
          name="dataset_id"
          required
          inputMode="numeric"
          pattern="[0-9]{5,20}"
          maxLength={20}
          defaultValue={defaults?.datasetId ?? ""}
        />
        <p className="text-xs leading-5 text-slate-500">{PIXEL_COPY.datasetHelp}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-token`}>Access token</Label>
        <Input
          id={`${idPrefix}-token`}
          name="access_token"
          type="password"
          autoComplete="off"
          required={!editing}
          maxLength={1024}
        />
        <p className="text-xs leading-5 text-slate-500">
          {editing && tokenLastFour
            ? `Leave blank to keep the saved token ending ${tokenLastFour}.`
            : PIXEL_COPY.tokenHelp}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-test-code`}>Test event code (optional)</Label>
        <Input
          id={`${idPrefix}-test-code`}
          name="test_event_code"
          maxLength={40}
          defaultValue={defaults?.testEventCode ?? ""}
        />
        <p className="text-xs leading-5 text-slate-500">{PIXEL_COPY.testCodeHelp}</p>
      </div>
    </div>
  );
}
