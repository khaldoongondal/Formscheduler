import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const inputClass =
  "flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export const BASE_RANGE_PRESETS: Array<{ value: string; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_7_days", label: "Last 7 days" },
  { value: "last_30_days", label: "Last 30 days" },
  { value: "custom", label: "Custom" }
];

/** A date as YYYY-MM-DD in server local time (matches the range resolver). */
export function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** GET form with a preset and custom from/to dates. Extra presets go first (for example "Whole test"). */
export function DateRangeFilter({
  range,
  extraPresets = []
}: {
  range: { from: Date; to: Date; preset: string };
  extraPresets?: Array<{ value: string; label: string }>;
}) {
  const presets = [...extraPresets, ...BASE_RANGE_PRESETS];
  return (
    <form className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
      <div className="space-y-1.5">
        <Label htmlFor="analytics-preset" className="text-xs text-slate-500">
          Range
        </Label>
        <select id="analytics-preset" name="preset" className={inputClass} defaultValue={range.preset}>
          {presets.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="analytics-from" className="text-xs text-slate-500">
          From
        </Label>
        <Input id="analytics-from" name="from" type="date" defaultValue={formatDateInput(range.from)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="analytics-to" className="text-xs text-slate-500">
          To
        </Label>
        <Input id="analytics-to" name="to" type="date" defaultValue={formatDateInput(range.to)} />
      </div>
      <Button type="submit" variant="outline" className="w-full md:w-auto">
        Apply
      </Button>
    </form>
  );
}
