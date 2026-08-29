/**
 * Davidson County / Metro Nashville (019).
 *
 * Metro's public Cadastral ArcGIS service fills BOTH provider roles and
 * carries more than the assessor's own web portal exposes to a query: full
 * valuation, owner mailing address, deed instrument, land use, zoning, and —
 * uniquely among the sources here — council district and census tract.
 *
 * The portal (portal.padctn.org) is a DevExpress app whose SEARCH needs a
 * session, but whose DETAIL pages are plain deep links and need no cookie at
 * all: `/OFS/WP/Summary/{account}/{card}/false` and
 * `/OFS/WP/Print/{account}/{card}` return identical bytes cold. Those remain
 * available for the building-characteristics record card, which the GIS layer
 * does not carry; see PORTAL_SUMMARY_URL below.
 *
 * Field notes measured against live data (2026-08-29):
 *   Owner populated   286,883
 *   Council populated 286,881
 *   Acres > 0         217,001  (76%)
 *   IsActive is the STRING 'Y'/'N', not a number - `IsActive = 1` 500s.
 *   OwnDate is epoch millis.
 *
 * RELIABILITY: this server fails roughly 40-50% of requests with an ArcGIS
 * 500 inside a 200 response, independent of the query. Every call goes
 * through retryTransient. Do not infer anything about this endpoint from a
 * single request - an early read of this layer "established" an `=` vs `LIKE`
 * difference and an unfilterable APN column, and repeating each call ten
 * times showed both were noise.
 */

import { httpJson } from '../http.js';
import {
  num, str, sql, epochDate, ringsToGeoJson, throwOnEsriError, retryTransient,
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
  'https://maps.nashville.gov/arcgis/rest/services/Cadastral/Cadastral_Layers/MapServer/4';
const JUR = '019';

/** Deep-linkable, session-free portal pages for the record card. */
export const PORTAL_SUMMARY_URL = (account: string | number, card = 1) =>
  `https://portal.padctn.org/OFS/WP/Summary/${account}/${card}/false`;
export const PORTAL_PRINT_URL = (account: string | number, card = 1) =>
  `https://portal.padctn.org/OFS/WP/Print/${account}/${card}`;

const FIELDS = [
  'ParID', 'APN', 'STANPAR', 'Owner', 'PropAddr', 'PropCity', 'PropZip',
  'OwnAddr1', 'OwnAddr2', 'OwnCity', 'OwnState', 'OwnZip',
  'LandAppr', 'ImprAppr', 'TotlAppr', 'LandAssd', 'ImprAssd', 'TotlAssd',
  'SalePrice', 'OwnDate', 'OwnInstr', 'PropInstr', 'ValidSale',
  'Acres', 'DeededAcreage', 'FinishArea', 'FirstFloor', 'DUCount',
  'LUCode', 'LUDesc', 'Zoning', 'Council', 'Tract', 'TaxDist', 'LegalDesc',
  'AssessZone', 'IsExempt', 'IsActive',
].join(',');

type Attrs = EsriAttrs;
type Resp = EsriQueryResponse;

async function query(params: Record<string, string>): Promise<Resp> {
  const qs = new URLSearchParams({ f: 'json', ...params });
  const res = await retryTransient(() => httpJson<Resp>(`${LAYER}/query?${qs}`));
  throwOnEsriError(res, 'Davidson');
  return res;
}

/**
 * APN is the durable parcel key, e.g. "06004004600". The portal and the map
 * both display it map-and-parcel formatted ("060 04 0 046.00"); the GIS field
 * is the unpunctuated form, which is what round-trips.
 */
function toRef(a: Attrs): TnParcelRef {
  const apn = str(a.STANPAR) ?? str(a.APN) ?? '';
  return {
    jur: JUR,
    // Davidson's APN packs map(3) group(2) parcel-ish; it is not the
    // control-map/group/parcel triple the TPAD counties use, so decomposition
    // would be an invention. Keep the parcel slot honest and let nativeId
    // carry identity, as it does for every non-TPAD source.
    controlMap: apn.slice(0, 3),
    mapGroup: apn.slice(3, 5),
    parcel: apn.slice(5),
    specialInterest: '',
    nativeId: apn,
    source: 'padctn',
  };
}

function toSummary(a: Attrs): ParcelSummary {
  return {
    ref: toRef(a),
    county: 'Davidson',
    owner: str(a.Owner),
    propertyAddress: str(a.PropAddr),
    city: str(a.PropCity),
    landUse: str(a.LUDesc),
    totalAppraised: num(a.TotlAppr),
    acres: (num(a.Acres) ?? 0) > 0 ? num(a.Acres) : undefined,
    lastSaleDate: epochDate(a.OwnDate),
    lastSalePrice: num(a.SalePrice),
    source: 'padctn',
  };
}

function toDetail(a: Attrs): ParcelDetail {
  const mail = [
    str(a.OwnAddr1), str(a.OwnAddr2),
    [str(a.OwnCity), str(a.OwnState), str(a.OwnZip)].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ');

  const instrument = str(a.OwnInstr) ?? str(a.PropInstr);
  return {
    ...toSummary(a),
    ownerMailingAddress: mail || undefined,
    landMarketValue: num(a.LandAppr),
    improvementValue: num(a.ImprAppr),
    totalMarketAppraisal: num(a.TotlAppr),
    assessedValue: num(a.TotlAssd),
    zoning: str(a.Zoning),
    livingAreaSqFt: num(a.FinishArea),
    taxDistrict: str(a.TaxDist),
    // The GIS layer carries only the current transfer, not a chain.
    sales: instrument || a.OwnDate || a.SalePrice != null
      ? [{
          date: epochDate(a.OwnDate),
          price: num(a.SalePrice) ?? null,
          instrument,
          qualification: str(a.ValidSale),
        }]
      : [],
    raw: a,
  };
}

function whereFor(o: SearchOptions): string {
  const cl: string[] = [];
  const like = (f: string, v: string) => `UPPER(${f}) LIKE '${sql(v.toUpperCase())}%'`;
  if (o.owner) cl.push(like('Owner', o.owner));
  if (o.address) cl.push(like('PropAddr', o.address));
  // STANPAR is the durable public parcel number and mirrors APN. Accept the
  // punctuated map-and-parcel form users copy from the portal.
  if (o.parcelId) cl.push(like('STANPAR', o.parcelId.replace(/[\s.]/g, '')));
  if (o.subdivision) cl.push(like('LegalDesc', o.subdivision));
  if (o.query && !cl.length) {
    cl.push(`(${like('Owner', o.query)} OR ${like('PropAddr', o.query)})`);
  }
  return cl.length ? cl.join(' AND ') : '1=0';
}

export const davidsonAssessment: AssessmentProvider = {
  id: 'davidson',
  name: 'Davidson County / Metro Nashville Cadastral',
  jurs: [JUR],
  status: 'ready',
  supports: { owner: true, address: true, parcelId: true, subdivision: true, advanced: false },
  valuesOnSearch: true,

  async search(_jur, opts) {
    const res = await query({
      where: whereFor(opts),
      outFields: FIELDS,
      returnGeometry: 'false',
      resultRecordCount: String(Math.min(Math.max(opts.limit ?? 25, 1), 200)),
      outSR: '4326',
    });
    return (res.features ?? []).map((f) => toSummary(f.attributes));
  },

  async getDetail(ref) {
    const res = await query({
      where: `STANPAR = '${sql(ref.nativeId)}'`,
      outFields: FIELDS,
      returnGeometry: 'false',
      resultRecordCount: '1',
    });
    const f = res.features?.[0];
    if (!f) throw new Error(`Davidson parcel not found: ${ref.nativeId}`);
    return toDetail(f.attributes);
  },
};

export const davidsonGeometry: GeometryProvider = {
  id: 'davidson',
  name: 'Davidson County / Metro Nashville Cadastral',
  jurs: [JUR],
  status: 'ready',

  async getGeometry(ref): Promise<ParcelGeometry | null> {
    const res = await query({
      where: `STANPAR = '${sql(ref.nativeId)}'`,
      outFields: 'APN,STANPAR,Acres',
      returnGeometry: 'true',
      outSR: '4326',
      resultRecordCount: '1',
    });
    const f = res.features?.[0];
    const geometry = f?.geometry?.rings ? ringsToGeoJson(f.geometry.rings) : null;
    if (!f || !geometry) return null;
    const acres = num(f.attributes.Acres);
    return { ref: toRef(f.attributes), geometry, acres: acres && acres > 0 ? acres : undefined, source: 'padctn' };
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
