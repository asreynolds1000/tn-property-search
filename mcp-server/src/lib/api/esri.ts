/**
 * Shared ArcGIS REST protocol helpers.
 *
 * Four modules speak Esri REST against four different hosts with four
 * different transports (plain, referer-bound token, proxied, national). The
 * transport differences are real and stay with each provider; what is shared
 * is the protocol: response shapes, SQL literal escaping, value coercion, and
 * the ring-to-GeoJSON conversion.
 *
 * The conversion in particular MUST be shared. It was duplicated three times
 * as `{ type: 'Polygon', coordinates: rings }`, which is wrong in two ways at
 * once, and a wrong geometry copied three times gets fixed once and diverges
 * twice.
 */

import type { ParcelGeometry } from '../../types/parcel.js';

export type EsriAttrs = Record<string, string | number | null>;

export interface EsriFeature {
  attributes: EsriAttrs;
  geometry?: { rings?: number[][][] };
}

export interface EsriQueryResponse {
  features?: EsriFeature[];
  error?: { code?: number; message: string };
}

/** ArcGIS SQL string literal escape. Doubling the quote is complete here. */
export const sql = (v: string) => v.replace(/'/g, "''");

/**
 * Escape LIKE metacharacters.
 *
 * Unescaped, `%` in user input matches the whole county and `_` becomes a
 * single-character wildcard. Not a security issue (the literal cannot be
 * escaped) but it silently changes what the caller asked for.
 * Pair with `ESCAPE '\'` in the clause.
 */
export const likeLiteral = (v: string) => sql(v).replace(/([%_[\]\\])/g, '\\$1');

/**
 * Numeric coercion.
 *
 * `/query` returns typed JSON values but `/identify` returns every attribute
 * as a STRING, so a `typeof v === 'number'` guard silently drops every
 * numeric field on the identify path.
 */
export function num(v: string | number | null | undefined): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function str(v: string | number | null | undefined): string | undefined {
  const s = v == null ? '' : String(v).trim();
  return s || undefined;
}

/** Epoch milliseconds to YYYY-MM-DD. */
export function epochDate(v: string | number | null | undefined): string | undefined {
  const n = num(v);
  if (!n) return undefined;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

/** Shoelace. Positive is counterclockwise in standard orientation. */
function signedArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return a / 2;
}

function closed(ring: number[][]): number[][] {
  if (ring.length < 3) return ring;
  const [f] = ring;
  const l = ring[ring.length - 1];
  return f[0] === l[0] && f[1] === l[1] ? ring : [...ring, [f[0], f[1]]];
}

/**
 * Convert Esri `rings` to GeoJSON geometry.
 *
 * Esri and GeoJSON disagree on two things, and assigning `rings` straight to
 * a Polygon's `coordinates` gets both wrong:
 *
 *  1. ORIENTATION. Esri winds exterior rings CLOCKWISE and holes
 *     counterclockwise. RFC 7946 is the exact opposite. Measured against live
 *     TNMap data, 100% of parcels come back clockwise, so a naive pass-through
 *     mislabels every parcel's exterior. Lenient viewers cope; winding-aware
 *     consumers (d3-geo, Google Maps Data layer, S2) read a CW "exterior" as
 *     the entire plane minus the parcel and render every parcel inverted.
 *
 *  2. MULTIPART. Esri puts all rings of a multipart feature in one flat list.
 *     GeoJSON Polygon treats every ring after the first as a HOLE in the
 *     first. A parcel split by a road is two separate polygons, but renders as
 *     one polygon with a bite out of it. Measured at 2.7% of a 150-parcel
 *     Greene sample, with one parcel carrying 3 rings — not an edge case.
 *
 * So: group by orientation (each CW ring starts a new part, CCW rings are
 * holes of the current part), then flip every ring to GeoJSON winding.
 */
export function ringsToGeoJson(
  rings: number[][][]
): ParcelGeometry['geometry'] | null {
  if (!rings?.length) return null;

  const parts: number[][][][] = [];
  for (const raw of rings) {
    const ring = closed(raw);
    if (ring.length < 4) continue;
    // Esri: negative signed area == clockwise == an exterior ring.
    if (signedArea(ring) < 0 || parts.length === 0) {
      parts.push([ring]);
    } else {
      parts[parts.length - 1].push(ring);
    }
  }
  if (!parts.length) return null;

  // GeoJSON: exterior counterclockwise, holes clockwise. Esri gave us the
  // reverse of both, so every ring flips.
  const oriented = parts.map((part) =>
    part.map((ring, i) => {
      const a = signedArea(ring);
      const wantPositive = i === 0; // exterior wants CCW
      return (a > 0) === wantPositive ? ring : [...ring].reverse();
    })
  );

  return oriented.length === 1
    ? { type: 'Polygon', coordinates: oriented[0] }
    : { type: 'MultiPolygon', coordinates: oriented };
}

/**
 * Retry a query that fails with a transient ArcGIS 500.
 *
 * Some county servers are simply unreliable: Metro Nashville's Cadastral
 * MapServer returns `{"error":{"code":500}}` for roughly 40-50% of requests,
 * measured across repeated identical calls. The failures are independent of
 * the where clause, the operator, the field, and the parameter set.
 *
 * This matters beyond the retry: a single sample from an endpoint like this
 * is worthless as evidence. Comparing one `=` call against one `LIKE` call
 * will "prove" a difference that does not exist. Anything inferred about
 * these services needs repetition before it is written down as a fact.
 */
export async function retryTransient<T extends { error?: { code?: number } }>(
  fn: () => Promise<T>,
  attempts = 6
): Promise<T> {
  let last: T | undefined;
  for (let i = 0; i < attempts; i++) {
    const res = await fn();
    const code = res.error?.code;
    if (!code || (code !== 500 && code !== 503)) return res;
    last = res;
    // Brief linear backoff; these recover immediately, they are not overloaded.
    await new Promise((r) => setTimeout(r, 150 * (i + 1)));
  }
  return last as T;
}

/** Throw on an ArcGIS error delivered inside a 200 response. */
export function throwOnEsriError(res: { error?: { code?: number; message: string } }, who: string): void {
  if (res.error) {
    throw new Error(`${who}: ArcGIS error ${res.error.code ?? ''} ${res.error.message}`.trim());
  }
}
