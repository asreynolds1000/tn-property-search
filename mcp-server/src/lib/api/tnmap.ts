/**
 * TNMap — statewide parcel geometry (Comptroller / TN GIS).
 *
 * Covers the 86 TPAD counties ONLY. Measured 2026-08-29 with returnCountOnly:
 * Greene (control) 43,053 parcels; Davidson, Knox, Williamson, Shelby all 0.
 * TNMap's own config marks those nine `disabled`. Do not route holdout
 * counties here — they return an empty result that looks like "no such
 * parcel" rather than "wrong service".
 *
 * Auth is an ArcGIS token that is REFERER-BOUND. Replaying it without the
 * Referer header returns `{"error":{"code":498,"message":"Invalid Token"}}`
 * with HTTP **200**, which reads exactly like an expired credential and sends
 * you off chasing a refresh that will not help. Token and referer are cached
 * and sent as a unit.
 */

import { httpJson, httpText } from '../http.js';
import { num, ringsToGeoJson, type EsriFeature, type EsriQueryResponse } from './esri.js';
import type { GeometryProvider, ProviderStatus } from '../../types/providers.js';
import type { ParcelGeometry, ParcelSummary, TnParcelRef } from '../../types/parcel.js';
import { COUNTIES, resolveCounty } from '../constants.js';

const ORIGIN = 'https://tnmap.tn.gov';
const REFERER = `${ORIGIN}/assessment/`;
const SERVICE = `${ORIGIN}/arcgis/rest/services/CADASTRAL/STATEWIDE_PARCELS_WEB_MERCATOR/MapServer`;

/**
 * The cartograph document id is baked into the app bundle and rotates when
 * TNMap redeploys. `discoverCartographId` re-scrapes it rather than failing.
 */
const DEFAULT_CARTOGRAPH_ID = 'cN5kjevcTk0ZeATJwFjh';

interface ArcGisError {
  error?: { code: number; message: string };
}

/** ArcGIS reports auth failure in a 200 body, so status codes tell you nothing. */
function isTokenError(body: unknown): boolean {
  const code = (body as ArcGisError)?.error?.code;
  return code === 498 || code === 499;
}

let cachedToken: string | null = null;
let inFlight: Promise<string> | null = null;

async function discoverCartographId(): Promise<string> {
  const html = await httpText(`${ORIGIN}/assessment/`, { referer: REFERER });
  const chunk = html.match(/static\/js\/(main\.[a-z0-9]+\.chunk\.js)/i);
  if (!chunk) return DEFAULT_CARTOGRAPH_ID;
  const js = await httpText(`${ORIGIN}/assessment/static/js/${chunk[1]}`, { referer: REFERER });
  const id = js.match(/["']([A-Za-z0-9]{20})["']/);
  return id ? id[1] : DEFAULT_CARTOGRAPH_ID;
}

async function fetchToken(): Promise<string> {
  for (const id of [DEFAULT_CARTOGRAPH_ID, await discoverCartographId()]) {
    let text: string;
    try {
      text = await httpText(`${ORIGIN}/cms/cartographs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        referer: REFERER,
        body: JSON.stringify({ id }),
      });
    } catch {
      continue;
    }
    // A wrong/rotated id returns TNMap's HTML 404 page, not JSON.
    if (text.trimStart().startsWith('<')) continue;
    const m =
      text.match(/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}\?token=([^"'&]+)/) ??
      text.match(/"token"\s*:\s*"([^"]{40,})"/);
    if (m) return m[1];
  }
  throw new Error(
    'Could not obtain a TNMap ArcGIS token from /cms/cartographs. ' +
      'The cartograph document id may have rotated with a TNMap redeploy.'
  );
}

/** Lazy, single-flight, reactive. Never fetched at construction time. */
async function getToken(force = false): Promise<string> {
  if (cachedToken && !force) return cachedToken;
  if (!inFlight) {
    inFlight = fetchToken()
      .then((t) => {
        cachedToken = t;
        return t;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Query with one reactive retry when ArcGIS reports a token failure. */
async function arcgis<T>(path: string, params: Record<string, string>): Promise<T> {
  for (const attempt of [0, 1]) {
    const token = await getToken(attempt === 1);
    const qs = new URLSearchParams({ ...params, f: 'json', token });
    const body = await httpJson<T & ArcGisError>(`${SERVICE}${path}?${qs}`, {
      referer: REFERER,
    });
    if (!isTokenError(body)) {
      // Any OTHER ArcGIS error also arrives inside a 200 body. Returning it
      // verbatim makes getGeometry see no features and report "not found",
      // which is the exact confusion this project exists to avoid.
      const e = (body as ArcGisError).error;
      if (e) throw new Error(`TNMap: ArcGIS error ${e.code} ${e.message}`);
      return body;
    }
    // Only clear the cache if nobody has already replaced it, or concurrent
    // callers null out each other's freshly-fetched good tokens.
    if (cachedToken === token) cachedToken = null;
  }
  throw new Error('TNMap rejected the token twice; the service may have changed auth.');
}


/** TNMap GISLINK is jur + control map + group + parcel, space-padded to width. */
export function toGisLink(ref: TnParcelRef): string {
  const cm = ref.controlMap.padEnd(5, ' ');
  const gp = (ref.mapGroup || '').padEnd(2, ' ');
  const pc = ref.parcel.padStart(5, '0');
  return `${ref.jur}${cm}${gp}${pc}`;
}

/**
 * Decompose a GISLINK positionally: jur(3) cmap(5) gp(2) parcel(5) = 15 chars.
 *
 * Preferred over the separate CMAP/GP/PARCEL attributes because those are
 * FORMATTED for display: /identify returns PARCEL as "002.00" where the key
 * layout wants "00200". Rebuilding a TPAD key from the formatted value
 * produces "030098K B 002.00 000", which matches no parcel.
 */
function fromGisLink(gislink: string): Pick<TnParcelRef, 'controlMap' | 'mapGroup' | 'parcel'> | null {
  if (gislink.length < 15) return null;
  return {
    controlMap: gislink.slice(3, 8).trim(),
    mapGroup: gislink.slice(8, 10).trim(),
    parcel: gislink.slice(10, 15).trim(),
  };
}

function toRef(attrs: Record<string, string | number | null>): TnParcelRef {
  const jur = String(attrs.CONUM ?? '').padStart(3, '0');
  const gislink = String(attrs.GISLINK ?? '');
  const parts = fromGisLink(gislink);
  return {
    jur,
    controlMap: parts?.controlMap ?? String(attrs.CMAP ?? '').trim(),
    mapGroup: parts?.mapGroup ?? String(attrs.GP ?? '').trim(),
    parcel: parts?.parcel ?? String(attrs.PARCEL ?? '').trim(),
    // GISLINK omits the special interest, but PARCELID carries it:
    // "030 133E C 00100 000 2026". Without it a ref crossing to TPAD cannot
    // be rebuilt into a parcelKey, and TPAD answers a malformed key with an
    // empty page that parses to all-undefined rather than an error.
    specialInterest: specialInterestFromParcelId(attrs.PARCELID),
    nativeId: gislink,
    source: 'tnmap',
  };
}

/** PARCELID is "<jur> <cmap> <gp> <parcel> <si> <taxyear>"; take the SI. */
function specialInterestFromParcelId(v: string | number | null | undefined): string {
  const parts = String(v ?? '').trim().split(/\s+/);
  // Trailing element is a 4-digit tax year; the one before it is the SI.
  return parts.length >= 2 && /^\d{4}$/.test(parts[parts.length - 1])
    ? parts[parts.length - 2]
    : '';
}

function toSummary(attrs: Record<string, string | number | null>): ParcelSummary {
  const county = resolveCounty(String(attrs.CONUM ?? ''));
  const owner2 = String(attrs.OWNER2 ?? '').trim();
  return {
    ref: toRef(attrs),
    county: county?.name ?? '',
    owner: String(attrs.OWNER ?? '').trim() || undefined,
    ownerSecondary: owner2 || undefined,
    propertyAddress: String(attrs.ADDRESS ?? '').trim() || undefined,
    subdivision: String(attrs.SUBDIV ?? '').trim() || undefined,
    lot: String(attrs.LOT ?? '').trim() || undefined,
    acres: num(attrs.CALC_ACRE),
    source: 'tnmap',
  };
}

export const tnmapGeometryProvider: GeometryProvider = {
  id: 'tnmap',
  name: 'TNMap Statewide Parcels',
  jurs: COUNTIES.filter((c) => c.tpad).map((c) => c.jur),
  status: 'ready' as ProviderStatus,

  async getGeometry(ref: TnParcelRef): Promise<ParcelGeometry | null> {
    const res = await arcgis<EsriQueryResponse>('/0/query', {
      where: `GISLINK = '${toGisLink(ref).replace(/'/g, "''")}'`,
      outFields: 'GISLINK,PARCELID,CONUM,CMAP,GP,PARCEL,CALC_ACRE',
      outSR: '4326',
      returnGeometry: 'true',
    });
    const f = res.features?.[0];
    const geometry = f?.geometry?.rings ? ringsToGeoJson(f.geometry.rings) : null;
    if (!f || !geometry) return null;
    return {
      ref: toRef(f.attributes),
      geometry,
      acres: num(f.attributes.CALC_ACRE),
      source: 'tnmap',
    };
  },

  async lookupByPoint(lon: number, lat: number): Promise<ParcelSummary | null> {
    const d = 0.01;
    const res = await arcgis<{ results?: EsriFeature[] }>('/identify', {
      geometry: `${lon},${lat}`,
      mapExtent: `${lon - d},${lat - d},${lon + d},${lat + d}`,
      imageDisplay: '1,1,1',
      sr: '4326',
      layers: '0',
      tolerance: '0.01',
      returnGeometry: 'false',
      outFields: '*',
    });
    const hit = res.results?.[0];
    return hit ? toSummary(hit.attributes) : null;
  },
};
