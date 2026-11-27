const campaignKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_id", "utm_term", "utm_content"] as const;
const clickKeys = ["gclid", "dclid", "gbraid", "wbraid"] as const;
type AttributionKey = typeof campaignKeys[number] | typeof clickKeys[number];
export type BrowserAttribution = Partial<Record<AttributionKey, string>>;

/** Extract bounded campaign labels and opaque Google click IDs. Never return a landing URL. */
export function readBrowserAttribution(search: string): BrowserAttribution {
  const query = new URLSearchParams(search);
  let landing: URLSearchParams | undefined;
  // Existing iframe and popup snippets include the landing URL for native attribution.
  // Reading its query here also works for previously copied snippets.
  const source = query.get("landing_page_url");
  if (source && source.length <= 8192) {
    try {
      const url = new URL(source);
      if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) landing = url.searchParams;
    } catch { /* Missing or invalid landing URL. */ }
  }
  function value(key: string) {
    return query.get(key) || landing?.get(key) || "";
  }
  const attribution: BrowserAttribution = {};
  for (const key of campaignKeys) {
    const label = value(key) || (key === "utm_id" ? value("utm_campaignid") : "");
    // Accept short marketer-authored labels, including spaces, but reject links,
    // addresses with @, and telephone-shaped labels. IDs can be entirely numeric.
    const validLabel = label.length <= 80 && /^[A-Za-z0-9][A-Za-z0-9_-]*(?: [A-Za-z0-9][A-Za-z0-9_-]*)*$/.test(label);
    if (validLabel && (key === "utm_id" ? !label.includes(" ") : !/^[\d -]{7,}$/.test(label))) {
      attribution[key] = label;
    }
  }
  for (const key of clickKeys) {
    let id = value(key);
    // Older embed snippets forward _gcl_aw (GCL.timestamp.clickID) as gclid.
    if (key === "gclid" && /^GCL\.\d+\./.test(id)) id = landing?.get(key) || id.replace(/^GCL\.\d+\./, "");
    if (/^[A-Za-z0-9_-]{6,180}$/.test(id) && !/^[\d-]+$/.test(id)) attribution[key] = id;
  }
  return attribution;
}

function clientStorageKey(formId: string) { return `formbook_ga4_client:${formId}`; }

/** Called only after opt-in on a form with a direct GA4 destination. */
export function consentedGaClientId(formId: string): string {
  let storage: Storage | undefined;
  const key = clientStorageKey(formId);
  try {
    storage = window.localStorage;
    const stored = storage.getItem(key);
    if (stored && /^\d{1,10}\.\d{1,10}$/.test(stored)) return stored;
  } catch { /* Browsers may deny storage inside an embed. */ }
  const generated = crypto.getRandomValues(new Uint32Array(2)).join(".");
  try { storage?.setItem(key, generated); } catch { /* Keep this visit's in-memory ID. */ }
  return generated;
}

export function forgetGaClientId(formId: string) {
  try { window.localStorage.removeItem(clientStorageKey(formId)); } catch { /* Storage unavailable. */ }
}
