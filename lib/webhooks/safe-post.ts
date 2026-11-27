/**
 * POSTs a webhook body to a tenant address (P3.5). Every resolved address
 * must be public; the socket connects to the address that was checked (DNS
 * pinning against rebinding). No redirects, 10 second total timeout, at most
 * 2 KB of the response is read. Logs carry the host only, never the path.
 */
import { lookup as dnsLookup } from "node:dns";
import { request } from "node:https";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";
import { CRM_SEND_TIMEOUT_MS } from "@/lib/crm/retry";
import { isPublicAddress } from "@/lib/webhooks/url-safety";

const MAX_RESPONSE_BYTES = 2048;

export type SafePostResult = { status: number | null; bodySnippet: string; error: string | null };

export const SAFE_POST_ERRORS = {
  blockedAddress: "blocked_address",
  redirect: "Redirects are not followed.",
  timeout: "timed_out",
  network: "network_error"
} as const;

class BlockedAddressError extends Error {
  constructor() {
    super(SAFE_POST_ERRORS.blockedAddress);
    this.name = "BlockedAddressError";
  }
}

/** Resolves every address, refuses when any is not public, hands the first one to the socket. */
const pinnedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) {
      callback(error, "", 0);
      return;
    }
    const list = Array.isArray(addresses) ? addresses : [];
    if (!list.length || list.some((entry) => !isPublicAddress(entry.address))) {
      callback(new BlockedAddressError(), "", 0);
      return;
    }
    const wanted = typeof options === "object" && options && "family" in options ? options.family : undefined;
    const chosen = list.find((entry) => !wanted || entry.family === wanted) ?? list[0];
    if (typeof options === "object" && options && "all" in options && options.all) {
      (callback as unknown as (err: null, addresses: Array<{ address: string; family: number }>) => void)(null, [chosen]);
      return;
    }
    callback(null, chosen.address, chosen.family);
  });
};

function cleanSnippet(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 200);
}

export async function safePostJson(url: URL, body: string, headers: Record<string, string>): Promise<SafePostResult> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:") return { status: null, bodySnippet: "", error: SAFE_POST_ERRORS.blockedAddress };
  if (isIP(host) && !isPublicAddress(host)) return { status: null, bodySnippet: "", error: SAFE_POST_ERRORS.blockedAddress };

  return new Promise<SafePostResult>((resolve) => {
    let settled = false;
    const finish = (result: SafePostResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const req = request(
      {
        protocol: "https:",
        hostname: host,
        port: url.port ? Number(url.port) : 443,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body, "utf8").toString() },
        // An IP literal was checked above; a name is checked on every resolution.
        lookup: isIP(host) ? undefined : pinnedLookup,
        servername: isIP(host) ? undefined : host,
        agent: false
      },
      (response) => {
        const status = response.statusCode ?? null;
        if (status !== null && status >= 300 && status < 400) {
          response.destroy();
          req.destroy();
          finish({ status, bodySnippet: "", error: SAFE_POST_ERRORS.redirect });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          if (size >= MAX_RESPONSE_BYTES) return;
          chunks.push(chunk);
          size += chunk.length;
          if (size >= MAX_RESPONSE_BYTES) {
            finish({ status, bodySnippet: cleanSnippet(Buffer.concat(chunks).toString("utf8", 0, MAX_RESPONSE_BYTES)), error: null });
            response.destroy();
            req.destroy();
          }
        });
        response.on("end", () => finish({ status, bodySnippet: cleanSnippet(Buffer.concat(chunks).toString("utf8")), error: null }));
        response.on("error", () => finish({ status, bodySnippet: cleanSnippet(Buffer.concat(chunks).toString("utf8")), error: null }));
      }
    );

    const timer = setTimeout(() => {
      req.destroy();
      finish({ status: null, bodySnippet: "", error: SAFE_POST_ERRORS.timeout });
    }, CRM_SEND_TIMEOUT_MS);

    req.on("error", (error) => {
      const blocked = error instanceof BlockedAddressError || error.message === SAFE_POST_ERRORS.blockedAddress;
      if (!blocked) console.error("[webhooks] send failed", host, error.name);
      finish({ status: null, bodySnippet: "", error: blocked ? SAFE_POST_ERRORS.blockedAddress : SAFE_POST_ERRORS.network });
    });

    req.end(body, "utf8");
  });
}
