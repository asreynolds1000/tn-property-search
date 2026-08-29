/**
 * Williamson County (094) — public ArcGIS Online feature service.
 *
 * The easiest source in the project: no token, no proxy, no referer, no
 * session. One layer satisfies BOTH provider roles, and its search rows
 * already carry valuations and deed references, so `getDetail` is usually a
 * second read of the same row rather than a separate fetch.
 */

import { httpJson } from '../http.js';
import {
  num, str, sql, ringsToGeoJson, throwOnEsriError,
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

const LAYER =
  'https://services8.arcgis.com/hkhKI6Qq7rjvBjZU/arcgis/rest/services/Parcels/FeatureServer/0';
const JUR = '094';

const FIELDS = [
  'PIN', 'PARCEL_ID', 'GISLINK', 'ADDRESS', 'CITY', 'OWNER_1', 'OWNER_2',
  'OWN_STREET', 'OWN_CITY', 'OWN_STATE', 'OWN_ZIP', 'NEIGHBORHD', 'PROP_TYP',
  'LAND_MARKE', 'IMP_VAL', 'TOTAL_MARK', 'LAND_ASSES', 'IMP_ASSES', 'TOTAL_ASSE',
  'SQFT_ASSES', 'AC', 'DEED_BK_LS', 'DEED_PG_LS', 'CONSIDER_L',
  'DEED_BK_LT', 'DEED_PG_LT', 'CONSIDER_1',
].join(',');

type Attrs = EsriAttrs;
type EsriResp = EsriQueryResponse;

/** ArcGIS SQL string literal: single quotes double up. */

async function query(params: Record<string, string>): Promise<EsriResp> {
  const qs = new URLSearchParams({ f: 'json', ...params });
  const res = await httpJson<EsriResp>(`${LAYER}/query?${qs}`);
  throwOnEsriError(res, 'Williamson');
  return res;
}


/**
 * Acreage, or undefined.
 *
 * `AC` is 0 on 84,334 of 107,578 parcels (78%, measured 2026-08-29), so
 * passing it through reports "0 acres" for most of the county — which a
 * caller cannot distinguish from a real zero.
 *
 * `Shape__Area` is NOT a usable fallback despite being populated on 100% of
 * rows: it is Web Mercator square metres, and the implied ratio against
 * known-good AC values ranges 5,880-6,384 (a 9% spread from latitude
 * distortion). A derived figure that is ~6% off looks authoritative and would
 * be used for land valuation. Omit instead.
 */
export function acres(v: string | number | null | undefined): number | undefined {
  const n = num(v);
  return n && n > 0 ? n : undefined;
}

function toRef(a: Attrs): TnParcelRef {
  // Williamson PIN packs control map, group and parcel: "154I I 03100 00011154P"
  const pin = String(a.PIN ?? a.PARCEL_ID ?? '').trim();
  const parts = pin.split(/\s+/);
  return {
    jur: JUR,
    controlMap: parts[0] ?? '',
    mapGroup: parts[1] ?? '',
    parcel: parts[2] ?? '',
    specialInterest: parts[3] ?? '',
    nativeId: pin,
    source: 'williamson',
  };
}

function toSummary(a: Attrs): ParcelSummary {
  return {
    ref: toRef(a),
    county: 'Williamson',
    owner: str(a.OWNER_1),
    ownerSecondary: str(a.OWNER_2),
    propertyAddress: str(a.ADDRESS),
    city: str(a.CITY),
    subdivision: str(a.NEIGHBORHD),
    propertyClass: str(a.PROP_TYP),
    totalAppraised: num(a.TOTAL_MARK),
    acres: acres(a.AC),
    lastSalePrice: num(a.CONSIDER_L),
    source: 'williamson',
  };
}

function toDetail(a: Attrs): ParcelDetail {
  const mail = [str(a.OWN_STREET), [str(a.OWN_CITY), str(a.OWN_STATE), str(a.OWN_ZIP)]
    .filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return {
    ...toSummary(a),
    ownerMailingAddress: mail || undefined,
    landMarketValue: num(a.LAND_MARKE),
    improvementValue: num(a.IMP_VAL),
    totalMarketAppraisal: num(a.TOTAL_MARK),
    assessedValue: num(a.TOTAL_ASSE),
    livingAreaSqFt: num(a.SQFT_ASSES),
    // Two deed slots: LS = last sale, LT = the one before it.
    sales: [
      { book: str(a.DEED_BK_LS), page: str(a.DEED_PG_LS), price: num(a.CONSIDER_L) ?? null },
      { book: str(a.DEED_BK_LT), page: str(a.DEED_PG_LT), price: num(a.CONSIDER_1) ?? null },
    ].filter((s) => s.book || s.page || s.price),
    raw: a,
  };
}

export function whereFor(o: SearchOptions): string {
  const cl: string[] = [];
  const like = (f: string, v: string) => `UPPER(${f}) LIKE '${sql(v.toUpperCase())}%'`;
  if (o.owner) cl.push(`(${like('OWNER_1', o.owner)} OR ${like('OWNER_2', o.owner)})`);
  if (o.address) cl.push(like('ADDRESS', o.address));
  if (o.parcelId) cl.push(like('PIN', o.parcelId));
  if (o.subdivision) cl.push(like('NEIGHBORHD', o.subdivision));
  if (o.query && !cl.length) {
    cl.push(`(${like('OWNER_1', o.query)} OR ${like('ADDRESS', o.query)})`);
  }
  return cl.length ? cl.join(' AND ') : '1=0';
}

export const williamsonAssessment: AssessmentProvider = {
  id: 'williamson',
  name: 'Williamson County Parcels (ArcGIS Online)',
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
      outSR: '4326',
    });
    return (res.features ?? []).map((f) => toSummary(f.attributes));
  },

  async getDetail(ref) {
    const res = await query({
      where: `PIN = '${sql(ref.nativeId)}'`,
      outFields: FIELDS,
      returnGeometry: 'false',
      resultRecordCount: '1',
    });
    const f = res.features?.[0];
    if (!f) throw new Error(`Williamson parcel not found: ${ref.nativeId}`);
    return toDetail(f.attributes);
  },
};

export const williamsonGeometry: GeometryProvider = {
  id: 'williamson',
  name: 'Williamson County Parcels (ArcGIS Online)',
  jurs: [JUR],
  status: 'ready',

  async getGeometry(ref): Promise<ParcelGeometry | null> {
    const res = await query({
      where: `PIN = '${sql(ref.nativeId)}'`,
      outFields: 'PIN,AC',
      returnGeometry: 'true',
      outSR: '4326',
      resultRecordCount: '1',
    });
    const f = res.features?.[0];
    const geometry = f?.geometry?.rings ? ringsToGeoJson(f.geometry.rings) : null;
    if (!f || !geometry) return null;
    return { ref: toRef(f.attributes), geometry, acres: acres(f.attributes.AC), source: 'williamson' };
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
