"use client";

import { useState, type FormEvent } from "react";
import { REPORT_REASONS, REPORT_REASON_LABELS } from "@/lib/validation/form-reports";

type Status = "idle" | "sending" | "sent";

export function ReportForm({ slug }: { slug: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatus("sending");
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/form-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          reason: String(form.get("reason") ?? ""),
          details: String(form.get("details") ?? ""),
          email: String(form.get("email") ?? "")
        })
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Something went wrong. Please try again.");
        setStatus("idle");
        return;
      }
      setStatus("sent");
    } catch {
      setError("Something went wrong. Please try again.");
      setStatus("idle");
    }
  }

  if (status === "sent") {
    return (
      <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">
        Thanks. Your report was sent.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="report-reason" className="text-sm font-medium text-slate-800">
          Reason
        </label>
        <select
          id="report-reason"
          name="reason"
          required
          defaultValue={REPORT_REASONS[0]}
          className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
        >
          {REPORT_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {REPORT_REASON_LABELS[reason]}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <label htmlFor="report-details" className="text-sm font-medium text-slate-800">
          What did you see? (optional)
        </label>
        <textarea
          id="report-details"
          name="details"
          maxLength={1000}
          rows={4}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="report-email" className="text-sm font-medium text-slate-800">
          Your email, if you want a reply (optional)
        </label>
        <input
          id="report-email"
          name="email"
          type="email"
          maxLength={254}
          autoComplete="email"
          className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
        />
      </div>
      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={status === "sending"}
        className="inline-flex h-10 w-full items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
      >
        Send report
      </button>
    </form>
  );
}
