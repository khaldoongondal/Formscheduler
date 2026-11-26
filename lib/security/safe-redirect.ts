/**
 * Same-site redirect validation. Pure, and safe for the Edge runtime
 * (middleware imports it), so it uses only the global URL class.
 */

const BASE_ORIGIN = "https://formbook.invalid";

/**
 * Returns a same-site path or the fallback. Rejects non-strings, empty values,
 * values not starting with "/", values starting with "//" or "/\", any
 * backslash, control characters, and anything that resolves to another origin.
 * Returns pathname + search + hash.
 */
export function safeNextPath(value: unknown, fallback = "/admin/funnels"): string {
  if (typeof value !== "string") return fallback;
  if (value.length === 0 || value.length > 2048) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (value.includes("\\")) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;

  let url: URL;
  try {
    url = new URL(value, BASE_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE_ORIGIN) return fallback;

  return `${url.pathname}${url.search}${url.hash}`;
}
