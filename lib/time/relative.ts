/**
 * "5 minutes ago" style text for admin pages. Pure: no imports.
 */
export function relativeTime(iso: string | null | undefined, nowMs: number): string {
  const thenMs = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(thenMs)) return "at an unknown time";
  const seconds = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}
