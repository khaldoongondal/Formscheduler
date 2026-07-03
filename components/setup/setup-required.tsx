interface SetupRequiredProps {
  description: string;
  missingEnv: string[];
  title: string;
}

export function SetupRequired({ description, missingEnv, title }: SetupRequiredProps) {
  return (
    <main className="min-h-[60vh] bg-white px-4 py-10 text-slate-950 sm:px-6">
      <section className="mx-auto max-w-2xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Local setup required</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>

        <div className="mt-6 rounded-md bg-slate-50 p-4">
          <p className="text-sm font-medium text-slate-900">Missing environment variables</p>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {missingEnv.map((key) => (
              <li key={key} className="font-mono">
                {key}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 rounded-md border border-slate-200 p-4 text-sm leading-6 text-slate-700">
          Create <span className="font-mono">.env.local</span> from{" "}
          <span className="font-mono">.env.example</span>, add your Supabase values, then restart{" "}
          <span className="font-mono">npm run dev</span>.
        </div>
      </section>
    </main>
  );
}
