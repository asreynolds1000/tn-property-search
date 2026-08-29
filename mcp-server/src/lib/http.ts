/**
 * Shared fetch wrapper.
 *
 * Every upstream here is a county or state web app, not an API product. Two
 * consequences shape this module:
 *
 *  - Several hosts gate on `Referer` rather than a key (TNMap's ArcGIS token is
 *    referer-bound; KGIS's proxy checks it). A missing Referer surfaces as
 *    "Invalid Token" or 401, which reads like an expired credential and sends
 *    you down the wrong path. Callers pass `referer` explicitly.
 *  - These are shared public services. Requests to a given host are serialized
 *    with a minimum gap so a burst of tool calls cannot hammer a county server.
 */

export interface FetchOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  referer?: string;
  /** Redirect handling. Session-based county adapters need 'manual' to
   *  capture Set-Cookie on intermediate 302s. */
  redirect?: RequestRedirect;
  timeoutMs?: number;
}

export const USER_AGENT =
  'tn-property-search-mcp/0.1 (+https://github.com/asreynolds1000/tn-property-search)';

/**
 * TPAD sits behind a Microsoft Azure Application Gateway whose WAF rejects any
 * non-browser User-Agent with a 403 — measured 2026-08-29 across our
 * identifying UA, a `Mozilla/5.0 (compatible; ...)` variant, and curl's
 * default. Only a full browser UA returns 200.
 *
 * This is a blunt WAF default, not a stated access policy: TPAD is the
 * Comptroller's public assessment data, published for public search, with no
 * terms restricting automated access (unlike Knox County, which states one
 * explicitly and is deliberately not implemented here). Every other source in
 * this project accepts the identifying UA above, so the override is scoped to
 * the one host that forces it rather than applied globally.
 */
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

const BROWSER_UA_HOSTS = new Set(['assessment.cot.tn.gov']);

export function userAgentFor(host: string): string {
  return BROWSER_UA_HOSTS.has(host) ? BROWSER_USER_AGENT : USER_AGENT;
}

/** Minimum milliseconds between requests to the same host. */
const HOST_MIN_GAP_MS = 350;

const hostQueue = new Map<string, Promise<unknown>>();
const lastHit = new Map<string, number>();

/** Serialize per host, with a floor on inter-request spacing. */
function withHostLimit<T>(host: string, fn: () => Promise<T>): Promise<T> {
  const prior = hostQueue.get(host) ?? Promise.resolve();
  const run = prior.then(async () => {
    const since = Date.now() - (lastHit.get(host) ?? 0);
    if (since < HOST_MIN_GAP_MS) {
      await new Promise((r) => setTimeout(r, HOST_MIN_GAP_MS - since));
    }
    try {
      return await fn();
    } finally {
      lastHit.set(host, Date.now());
    }
  });
  // Keep the chain alive even if this link rejects, or one failure wedges the host.
  hostQueue.set(
    host,
    run.then(
      () => undefined,
      () => undefined
    )
  );
  return run;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly bodySnippet: string
  ) {
    super(`HTTP ${status} for ${url}: ${bodySnippet.slice(0, 200)}`);
    this.name = 'HttpError';
  }
}

export async function httpText(url: string, opts: FetchOptions = {}): Promise<string> {
  const res = await httpRaw(url, opts);
  return res.text();
}

export async function httpJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  const text = await httpText(url, opts);
  try {
    return JSON.parse(text) as T;
  } catch {
    // An HTML error page returned with status 200 is common here (session
    // expiry, maintenance banners). Surface the shape, not a JSON.parse trace.
    throw new Error(
      `Expected JSON from ${url} but got ${text.trimStart().slice(0, 120)}`
    );
  }
}

export async function httpRaw(url: string, opts: FetchOptions = {}): Promise<Response> {
  const host = new URL(url).host;
  return withHostLimit(host, async () => {
    const headers: Record<string, string> = {
      'User-Agent': userAgentFor(host),
      Accept: '*/*',
      ...opts.headers,
    };
    if (opts.referer) headers.Referer = opts.referer;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 30_000);
    try {
      const res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body,
        redirect: opts.redirect ?? 'follow',
        signal: ac.signal,
      });
      if (!res.ok && res.status !== 302) {
        throw new HttpError(res.status, url, await res.text().catch(() => ''));
      }
      return res;
    } finally {
      clearTimeout(timer);
    }
  });
}

export function form(params: Record<string, string | number | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) usp.set(k, v == null ? '' : String(v));
  return usp.toString();
}
