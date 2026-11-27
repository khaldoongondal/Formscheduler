/**
 * Webhook address checks against server-side request forgery (P3.5).
 * Checked when the tenant saves the address and again before every send;
 * safe-post.ts also checks every resolved address. Pure: node:net only.
 */
import { isIP } from "node:net";

export const URL_SAFETY_MESSAGES = {
  unparseable: "Enter a full web address that starts with https://.",
  notHttps: "Webhook addresses must start with https://.",
  credentials: "Remove the user name and password from the address.",
  port: "Use the standard https port or a port from 1024 to 65535.",
  tooLong: "This address is too long.",
  notPublic: "Use a public address. Local and private addresses are not allowed."
} as const;

const MAX_URL_LENGTH = 2048;
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa"];

type V4Range = [number, number, number, number, number];

// [a, b, c, d, prefix length]
const BLOCKED_V4: V4Range[] = [
  [0, 0, 0, 0, 8],
  [10, 0, 0, 0, 8],
  [100, 64, 0, 0, 10],
  [127, 0, 0, 0, 8],
  [169, 254, 0, 0, 16],
  [172, 16, 0, 0, 12],
  [192, 0, 0, 0, 24],
  [192, 0, 2, 0, 24],
  [192, 88, 99, 0, 24],
  [192, 168, 0, 0, 16],
  [198, 18, 0, 0, 15],
  [198, 51, 100, 0, 24],
  [203, 0, 113, 0, 24],
  [224, 0, 0, 0, 4],
  [240, 0, 0, 0, 4]
];

function v4ToInt(parts: number[]): number {
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function parseV4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  if (numbers.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return null;
  return numbers;
}

function isPublicV4(parts: number[]): boolean {
  const value = v4ToInt(parts);
  for (const [a, b, c, d, prefix] of BLOCKED_V4) {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    if (((value & mask) >>> 0) === ((v4ToInt([a, b, c, d]) & mask) >>> 0)) return false;
  }
  return true;
}

/** Expands an IPv6 address to eight 16-bit groups, or null. Handles an embedded dotted IPv4 tail. */
function parseV6(ip: string): number[] | null {
  let address = ip.toLowerCase();
  const zone = address.indexOf("%");
  if (zone >= 0) address = address.slice(0, zone);
  const lastColon = address.lastIndexOf(":");
  const lastPart = address.slice(lastColon + 1);
  if (lastPart.includes(".")) {
    // "::ffff:10.0.0.1" becomes "::ffff:a00:1".
    const v4 = parseV4(lastPart);
    if (!v4) return null;
    address = `${address.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const doubleColon = address.split("::");
  if (doubleColon.length > 2) return null;
  const head = doubleColon[0] ? doubleColon[0].split(":") : [];
  const rest = doubleColon.length === 2 && doubleColon[1] ? doubleColon[1].split(":") : [];
  if ([...head, ...rest].some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  const toNumbers = (groups: string[]) => groups.map((group) => parseInt(group, 16));
  if (doubleColon.length === 2) {
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return null;
    return [...toNumbers(head), ...new Array<number>(missing).fill(0), ...toNumbers(rest)];
  }
  return head.length === 8 ? toNumbers(head) : null;
}

function embeddedV4(groups: number[], fromGroup: number): number[] {
  return [groups[fromGroup] >> 8, groups[fromGroup] & 0xff, groups[fromGroup + 1] >> 8, groups[fromGroup + 1] & 0xff];
}

function isPublicV6(groups: number[]): boolean {
  const allZeroUpTo = (n: number) => groups.slice(0, n).every((group) => group === 0);
  if (groups.every((group) => group === 0)) return false; // ::
  if (allZeroUpTo(7) && groups[7] === 1) return false; // ::1
  if ((groups[0] & 0xfe00) === 0xfc00) return false; // fc00::/7
  if ((groups[0] & 0xffc0) === 0xfe80) return false; // fe80::/10
  if ((groups[0] & 0xff00) === 0xff00) return false; // ff00::/8
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return false; // 2001:db8::/32
  // ::ffff:0:0/96 (IPv4-mapped)
  if (allZeroUpTo(5) && groups[5] === 0xffff) return isPublicV4(embeddedV4(groups, 6));
  // ::/96 IPv4-compatible (deprecated): treat by the embedded address.
  if (allZeroUpTo(6)) return isPublicV4(embeddedV4(groups, 6));
  // 64:ff9b::/96 (NAT64)
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((group) => group === 0)) {
    return isPublicV4(embeddedV4(groups, 6));
  }
  // 2002::/16 (6to4): the IPv4 address sits in groups 1 and 2.
  if (groups[0] === 0x2002) return isPublicV4(embeddedV4(groups, 1));
  return true;
}

/** True only for an address a webhook may be sent to. Anything unparseable is not public. */
export function isPublicAddress(ip: string): boolean {
  const trimmed = ip.trim().replace(/^\[|\]$/g, "");
  const family = isIP(trimmed.split("%")[0]);
  if (family === 4) {
    const parts = parseV4(trimmed);
    return parts ? isPublicV4(parts) : false;
  }
  if (family === 6) {
    const groups = parseV6(trimmed);
    return groups ? isPublicV6(groups) : false;
  }
  return false;
}

export function checkWebhookUrl(raw: string): { ok: true; url: URL } | { ok: false; message: string } {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length > MAX_URL_LENGTH) return { ok: false, message: URL_SAFETY_MESSAGES.tooLong };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, message: URL_SAFETY_MESSAGES.unparseable };
  }
  if (url.protocol !== "https:") return { ok: false, message: URL_SAFETY_MESSAGES.notHttps };
  if (url.username || url.password) return { ok: false, message: URL_SAFETY_MESSAGES.credentials };
  if (url.port) {
    const port = Number(url.port);
    if (!(port === 443 || (port >= 1024 && port <= 65535))) return { ok: false, message: URL_SAFETY_MESSAGES.port };
  }
  if (url.href.length > MAX_URL_LENGTH) return { ok: false, message: URL_SAFETY_MESSAGES.tooLong };

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const bareHost = host.replace(/^\[|\]$/g, "");
  if (isIP(bareHost)) {
    return isPublicAddress(bareHost) ? { ok: true, url } : { ok: false, message: URL_SAFETY_MESSAGES.notPublic };
  }
  if (!host || host === "localhost" || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix)) || !host.includes(".")) {
    return { ok: false, message: URL_SAFETY_MESSAGES.notPublic };
  }
  // The WHATWG parser turns numeric hosts like 2130706433 or 0x7f.1 into dotted IPv4, caught above.
  return { ok: true, url };
}
