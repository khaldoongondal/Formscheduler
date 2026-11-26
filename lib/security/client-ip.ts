/**
 * Client IP from trusted platform headers. Pure: no Next.js or Supabase imports.
 *
 * Order: x-vercel-forwarded-for (first entry), x-real-ip, x-forwarded-for
 * (first entry), else "unknown". Vercel sets x-vercel-forwarded-for itself and
 * overwrites any value a client sends, so a spoofed x-forwarded-for cannot
 * change the key while the Vercel header is present.
 */

const MAX_IP_LENGTH = 64;

function firstEntry(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(",")[0]?.trim();
  return first ? first : null;
}

function normalizeIp(raw: string): string {
  let ip = raw.trim();

  // Bracketed IPv6 with optional port: [2001:db8::1]:443
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(ip);
  if (bracketed) {
    ip = bracketed[1];
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(ip)) {
    // IPv4 with a port: 203.0.113.7:51234
    ip = ip.slice(0, ip.lastIndexOf(":"));
  }

  if (ip.includes(":")) ip = ip.toLowerCase();
  return ip.slice(0, MAX_IP_LENGTH) || "unknown";
}

export function getClientIp(headers: Headers): string {
  const candidate =
    firstEntry(headers.get("x-vercel-forwarded-for")) ??
    firstEntry(headers.get("x-real-ip")) ??
    firstEntry(headers.get("x-forwarded-for"));

  return candidate ? normalizeIp(candidate) : "unknown";
}
