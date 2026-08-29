/**
 * Knox County (047) — KGIS.
 *
 * KGIS republishes the assessor's CAMA data as an ArcGIS layer, so it fills
 * BOTH provider roles and makes the county's own iasWorld portal unnecessary
 * for everything except building characteristics, sketches, permits and the
 * full sale chain. Field population measured across all 210,626 parcels
 * (2026-08-29):
 *
 *   OWNER              210,623   99.9%
 *   SUBDIVISION_NAME   209,168   99%
 *   APPRAISED_TOTAL    206,506   98%
 *   SALE_DATE          203,322   96%
 *   DEED_BOOK          183,288   87%
 *   PURCHASE_PRICE     137,332   65%
 *   DATE_PURCHASED           0   dead column - use SALE_DATE
 *
 * Access is through KGIS's own proxy; the ArcGIS host 401s directly. The
 * target URL must be percent-encoded ENTIRELY as the proxy's query string, or
 * the `%` in a `LIKE 'SMITH%'` pattern is consumed as an escape and the
 * response comes back as non-JSON.
 */

import { httpJson } from '../http.js';
import {
  num, str, sql, epochDate, ringsToGeoJson, throwOnEsriError,
  type EsriAttrs, type EsriQueryResponse,
} from './esri.js';
import type {
  AssessmentProvider,
  GeometryProvider,
  SearchOptions,
} from '../../types/providers.js';
import type {
  ParcelDetail,
  ParcelGeometry,
  ParcelSummary,
  TnParcelRef,
} from '../../types/parcel.js';

const PROXY = 'https://www.kgis.org/proxy/proxy.ashx?';
const REFERER = 'https://www.kgis.org/kgismaps/Map.htm';
const PARCELS =
  'https://www.kgis.org/arcgis/rest/services/Maps/QueryTasks/MapServer/3/query';
const JUR = '047';

const FIELDS = [
  'PARCELID', 'BASE_PARCELID', 'CLTMAP', 'PARCEL_GROUP', 'PARCEL',
  'OWNER', 'FULL_ADDRESS', 'SUBDIVISION_NAME', 'LANDUSE', 'TAX_CLASS',
  'TAX_DISTRICT', 'SQUARE_FEET', 'APPRAISED_LAND', 'APPRAISED_BLDG',
  'APPRAISED_TOTAL', 'ASSESSED_TOTAL', 'SALE_DATE', 'PURCHASE_PRICE',
  'DEED_BOOK', 'DEED_PAGE', 'FULL_MAIL_ADDRESS', 'FULL_MAIL_CITY_STATE_ZIP',
].join(',');

type Attrs = EsriAttrs;
type EsriResp = EsriQueryResponse;


/**
 * Build a proxied URL.
 *
 * The whole target — including its query string — is one percent-encoded
 * component of the proxy URL. Appending params to the proxy instead lets the
 * proxy re-parse them, and `%` in a LIKE pattern breaks.
 */
export function proxied(target: string, params: Record<string, string>): string {
  const qs = new URLSearchParams({ f: 'json', ...params });
  return PROXY + encodeURIComponent(`${target}?${qs}`);
}

async function query(params: Record<string, string>): Promise<EsriResp> {
  const res = await httpJson<EsriResp>(proxied(PARCELS, params), { referer: REFERER });
  throwOnEsriError(res, 'KGIS');
  return res;
}


function toRef(a: Attrs): TnParcelRef {
  const native = String(a.PARCELID ?? '').trim();
  return {
    jur: JUR,
    controlMap: str(a.CLTMAP) ?? '',
    mapGroup: str(a.PARCEL_GROUP) ?? '',
    parcel: str(a.PARCEL) ?? '',
    specialInterest: '',
    nativeId: native,
    source: 'kgis',
  };
}

function toSummary(a: Attrs): ParcelSummary {
  return {
    ref: toRef(a),
    county: 'Knox',
    owner: str(a.OWNER),
    propertyAddress: str(a.FULL_ADDRESS),
    subdivision: str(a.SUBDIVISION_NAME),
    landUse: str(a.LANDUSE),
    totalAppraised: num(a.APPRAISED_TOTAL),
    lastSaleDate: epochDate(a.SALE_DATE),
    lastSalePrice: num(a.PURCHASE_PRICE),
    source: 'kgis',
  };
}

function toDetail(a: Attrs): ParcelDetail {
  const mail = [str(a.FULL_MAIL_ADDRESS), str(a.FULL_MAIL_CITY_STATE_ZIP)]
    .filter(Boolean)
    .join(', ');
  const sale = {
    date: epochDate(a.SALE_DATE),
    price: num(a.PURCHASE_PRICE) ?? null,
    book: str(a.DEED_BOOK),
    page: str(a.DEED_PAGE),
  };
  return {
    ...toSummary(a),
    ownerMailingAddress: mail || undefined,
    landMarketValue: num(a.APPRAISED_LAND),
    improvementValue: num(a.APPRAISED_BLDG),
    totalMarketAppraisal: num(a.APPRAISED_TOTAL),
    assessedValue: num(a.ASSESSED_TOTAL),
    livingAreaSqFt: num(a.SQUARE_FEET),
    taxClass: str(a.TAX_CLASS),
    taxDistrict: str(a.TAX_DISTRICT),
    // KGIS carries the current sale only, not the chain. Do not present this
    // as a complete history.
    sales: sale.date || sale.book || sale.price != null ? [sale] : [],
    raw: a,
  };
}

export function whereFor(o: SearchOptions): string {
  const cl: string[] = [];
  const like = (f: string, v: string) => `UPPER(${f}) LIKE '${sql(v.toUpperCase())}%'`;
  if (o.owner) cl.push(like('OWNER', o.owner));
  if (o.address) cl.push(like('FULL_ADDRESS', o.address));
  if (o.parcelId) cl.push(like('PARCELID', o.parcelId));
  if (o.subdivision) cl.push(like('SUBDIVISION_NAME', o.subdivision));
  if (o.query && !cl.length) {
    cl.push(`(${like('OWNER', o.query)} OR ${like('FULL_ADDRESS', o.query)})`);
  }
  return cl.length ? cl.join(' AND ') : '1=0';
}

export const kgisAssessment: AssessmentProvider = {
  id: 'kgis',
  name: 'Knox County / KGIS Parcels',
  jurs: [JUR],
  status: 'ready',
  supports: { owner: true, address: true, parcelId: true, subdivision: true, advanced: false },
  valuesOnSearch: true,

  async search(_jur, opts) {
    const res = await query({
      where: whereFor(opts),
      outFields: FIELDS,
      returnGeometry: 'false',
      resultRecordCount: String(Math.min(opts.limit ?? 25, 200)),
    });
    return (res.features ?? []).map((f) => toSummary(f.attributes));
  },

  async getDetail(ref) {
    const res = await query({
      where: `PARCELID = '${sql(ref.nativeId)}'`,
      outFields: FIELDS,
      returnGeometry: 'false',
      resultRecordCount: '1',
    });
    const f = res.features?.[0];
    if (!f) throw new Error(`Knox parcel not found: ${ref.nativeId}`);
    return toDetail(f.attributes);
  },
};

export const kgisGeometry: GeometryProvider = {
  id: 'kgis',
  name: 'Knox County / KGIS Parcels',
  jurs: [JUR],
  status: 'ready',

  async getGeometry(ref): Promise<ParcelGeometry | null> {
    const res = await query({
      where: `PARCELID = '${sql(ref.nativeId)}'`,
      outFields: 'PARCELID,CLTMAP,PARCEL_GROUP,PARCEL',
      returnGeometry: 'true',
      outSR: '4326',
      resultRecordCount: '1',
    });
    const f = res.features?.[0];
    const geometry = f?.geometry?.rings ? ringsToGeoJson(f.geometry.rings) : null;
    if (!f || !geometry) return null;
    return { ref: toRef(f.attributes), geometry, source: 'kgis' };
  },

  async lookupByPoint(lon, lat): Promise<ParcelSummary | null> {
    const res = await query({
      geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
      geometryType: 'esriGeometryPoint',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: FIELDS,
      returnGeometry: 'false',
      resultRecordCount: '1',
    });
    const f = res.features?.[0];
    return f ? toSummary(f.attributes) : null;
  },
};

// Re-exported for tests: the epoch-millis conversion is shared, but KGIS is
// the only source that uses it.
export { epochDate };
