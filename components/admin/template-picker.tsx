import { BLANK_TEMPLATE_COPY, BLANK_TEMPLATE_KEY, FORM_TEMPLATES, defaultTemplateChoice } from "@/lib/funnels/templates";

/** "Start from" radio cards for form creation (decision D17). Works without JavaScript. */
export function TemplatePicker({ selected }: { selected?: string | null }) {
  const checked = defaultTemplateChoice(selected);
  const choices = [
    { key: BLANK_TEMPLATE_KEY, name: BLANK_TEMPLATE_COPY.name, audience: null as string | null, summary: BLANK_TEMPLATE_COPY.summary },
    ...FORM_TEMPLATES.map((template) => ({
      key: template.key as string,
      name: template.name,
      audience: template.audience as string | null,
      summary: template.summary
    }))
  ];
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-slate-900">{BLANK_TEMPLATE_COPY.legend}</legend>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {choices.map((choice) => {
          const id = `template-${choice.key}`;
          return (
            <label
              key={choice.key}
              htmlFor={id}
              className="flex cursor-pointer gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm transition hover:border-slate-300 has-[:checked]:border-primary has-[:checked]:ring-2 has-[:checked]:ring-primary/20"
            >
              <input
                id={id}
                type="radio"
                name="template"
                value={choice.key}
                defaultChecked={choice.key === checked}
                className="mt-1 h-4 w-4 shrink-0"
              />
              <span className="min-w-0">
                <span className="block font-semibold text-slate-950">{choice.name}</span>
                {choice.audience ? <span className="mt-0.5 block text-xs text-slate-500">{choice.audience}</span> : null}
                <span className="mt-1 block leading-5 text-slate-600">{choice.summary}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
