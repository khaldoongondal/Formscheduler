import { CheckCircle2 } from "lucide-react";
import { UpgradeHint } from "@/components/admin/upgrade-hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SPLIT_TEST_COPY, splitTestStatusLabel } from "@/lib/split-tests/rules";
import type { SplitTestStatus } from "@/lib/types/database";

export const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export type FormChoice = {
  id: string;
  name: string;
  isPublished: boolean;
  takenDown: boolean;
  /** Running test that holds this form, unless it is the test being edited. */
  runningTestName: string | null;
};

function choiceLabel(choice: FormChoice) {
  if (choice.runningTestName) return `${choice.name} (In running test: ${choice.runningTestName})`;
  if (choice.takenDown) return `${choice.name} (Taken down)`;
  return `${choice.name} (${choice.isPublished ? "Active" : "Draft"})`;
}

export function StatusBadge({ status }: { status: SplitTestStatus }) {
  const className =
    status === "running"
      ? "bg-emerald-50 text-emerald-700"
      : status === "ended"
        ? "bg-blue-50 text-blue-700"
        : "bg-slate-100 text-slate-600";
  return (
    <span className={`rounded-md px-2 py-1 text-xs font-semibold ${className}`}>{splitTestStatusLabel(status)}</span>
  );
}

/** Name, address and form A/B/C fields shared by the create and draft edit forms. */
export function SplitTestFields({
  baseUrl,
  choices,
  defaults,
  idPrefix
}: {
  baseUrl: string;
  choices: FormChoice[];
  defaults?: { name: string; slug: string; formIds: string[] };
  idPrefix: string;
}) {
  const slots = [
    { key: "form_a", label: "Form A", required: true },
    { key: "form_b", label: "Form B", required: true },
    { key: "form_c", label: "Form C (optional)", required: false }
  ] as const;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-name`}>Name</Label>
        <Input
          id={`${idPrefix}-name`}
          name="name"
          required
          maxLength={120}
          defaultValue={defaults?.name ?? ""}
          placeholder="Spring offer test"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-slug`}>Test address</Label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <span className="shrink-0 break-all text-sm text-slate-500">{baseUrl}/t/</span>
          <Input
            id={`${idPrefix}-slug`}
            name="slug"
            required
            minLength={3}
            maxLength={80}
            defaultValue={defaults?.slug ?? ""}
            placeholder="spring-offer"
          />
        </div>
        <p className="text-xs leading-5 text-slate-500">{SPLIT_TEST_COPY.slugHelper}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {slots.map((slot, index) => (
          <div key={slot.key} className="space-y-2">
            <Label htmlFor={`${idPrefix}-${slot.key}`}>{slot.label}</Label>
            <select
              id={`${idPrefix}-${slot.key}`}
              name={slot.key}
              required={slot.required}
              className={selectClass}
              defaultValue={defaults?.formIds[index] ?? ""}
            >
              <option value="">{slot.required ? "Choose a form" : "No form C"}</option>
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id} disabled={Boolean(choice.runningTestName)}>
                  {choiceLabel(choice)}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <p className="text-sm leading-6 text-slate-600">{SPLIT_TEST_COPY.limitNote}</p>
    </div>
  );
}

export function ActionError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900" role="alert">
      <p className="font-semibold">This change was not saved.</p>
      <p>{message}</p>
      <UpgradeHint message={message} />
    </div>
  );
}

export function ActionSuccess({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="font-semibold">{message}</p>
    </div>
  );
}

export function formatDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric" }).format(new Date(value));
}
