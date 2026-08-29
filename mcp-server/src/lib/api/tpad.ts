/**
 * TPAD — Tennessee Property Assessment Data (Comptroller of the Treasury).
 *
 * Serves 86 of 95 counties. No auth, no cookie, no referer requirement - but
 * its WAF rejects non-browser User-Agents with a 403, which is why http.ts
 * sends a browser UA for this host specifically. A 403 here is that, not a ban.
 * The nine counties running their own CAMA systems are listed in TPAD's
 * dropdown but disabled; see COUNTIES in ../constants.ts.
 */

import { httpJson, httpText, form } from '../http.js';
import { resolveCounty, type County } from '../constants.js';
import { parseTpadDetail, type TpadDetail } from '../parsers/tpad-detail.js';

const BASE = 'https://assessment.cot.tn.gov/TPAD';

/** One row of TPAD's search result JSON, as returned upstream. */
export interface TpadSearchResult {
  parcelKey: string;
  jur: string;
  countyName: string;
  taxYear: string;
  owner: string;
  propertyAddress: string;
  controlMap: string;
  mapGroup: string;
  parcelNumber: string;
  parcelNumberString: string;
  specialInterest: string;
  parcelId: string;
  subdivisionName: string;
  lotNumber: string;
  class: string;
  propertyType: string;
  dateOfSaleShort: string;
  gisMap: string;
  score: number;
}

export interface TpadSearchParams {
  /** County name, '030', or 30. */
  county: string | number;
  /** Free-text query; TPAD scores across owner and address. */
  query?: string;
  owner?: string;
  propertyAddress?: string;
  subdivisionName?: string;
  propertyType?: string;
  controlMap?: string;
  mapGroup?: string;
  parcelNumber?: string;
  saleDateRangeStart?: string;
  saleDateRangeEnd?: string;
  sortBy?: 'Owner' | 'Address' | 'ParcelId';
}

export class TpadUnsupportedCountyError extends Error {
  constructor(readonly county: County) {
    super(
      `${county.name} County (${county.jur}) runs its own CAMA system and is not in TPAD. ` +
        `Route this search to the ${county.name} county adapter.`
    );
    this.name = 'TpadUnsupportedCountyError';
  }
}

function requireTpadCounty(input: string | number): County {
  const county = resolveCounty(input);
  if (!county) throw new Error(`Unknown Tennessee county: ${input}`);
  if (!county.tpad) throw new TpadUnsupportedCountyError(county);
  return county;
}

export async function searchProperties(p: TpadSearchParams): Promise<TpadSearchResult[]> {
  const county = requireTpadCounty(p.county);
  const body = form({
    Jur: county.jur,
    PropertyAddress: p.propertyAddress,
    SubdivisionName: p.subdivisionName,
    Query: p.query,
    Owner: p.owner,
    PropertyType: p.propertyType,
    SortBy: p.sortBy ?? 'Owner',
    SaleDateRangeStart: p.saleDateRangeStart,
    SaleDateRangeEnd: p.saleDateRangeEnd,
    ControlMap: p.controlMap,
    MapGroup: p.mapGroup,
    ParcelNumber: p.parcelNumber,
    GISLink: '',
  });
  return httpJson<TpadSearchResult[]>(`${BASE}/Search/GetSearchResults`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body,
  });
}

/** Owner-name suggestions. TPAD's own UI requires 3+ characters. */
export async function autocompleteOwner(
  countyInput: string | number,
  query: string
): Promise<string[]> {
  const county = requireTpadCounty(countyInput);
  const q = query.trim();
  if (q.length < 3) return [];
  return httpJson<string[]>(
    `${BASE}/Search/Autocomplete/${county.jur}/${encodeURIComponent(q)}`,
    { headers: { 'X-Requested-With': 'XMLHttpRequest' } }
  );
}

/**
 * Full assessment record.
 *
 * `parcelId` and `parcelKey` are space-padded fixed-width and must be passed
 * through exactly as TPAD returned them — trimming shifts the fields and the
 * lookup misses.
 */
export async function getPropertyDetails(args: {
  county: string | number;
  parcelId: string;
  parcelKey: string;
}): Promise<TpadDetail> {
  const county = requireTpadCounty(args.county);
  const qs = new URLSearchParams({
    parcelId: args.parcelId,
    jur: county.jur,
    parcelKey: args.parcelKey,
  });
  const html = await httpText(`${BASE}/Parcel/Details?${qs}`);
  return parseTpadDetail(html);
}

// --- AssessmentProvider adapter -------------------------------------------
// TPAD registers like any other provider rather than being special-cased in
// the tool layer, so routed tools have a single code path.

import type { AssessmentProvider, SearchOptions } from '../../types/providers.js';
import type { ParcelDetail, ParcelSummary, TnParcelRef } from '../../types/parcel.js';
import { COUNTIES } from '../constants.js';

/** TPAD ids are fixed-width and space-significant; keep nativeId verbatim. */
function refFromResult(r: TpadSearchResult): TnParcelRef {
  return {
    jur: r.jur,
    controlMap: r.controlMap.trim(),
    mapGroup: r.mapGroup.trim(),
    parcel: r.parcelNumber.trim(),
    specialInterest: r.specialInterest.trim(),
    nativeId: r.parcelKey,
    source: 'tpad',
  };
}

function summaryFromResult(r: TpadSearchResult): ParcelSummary {
  return {
    ref: refFromResult(r),
    county: r.countyName,
    owner: r.owner.trim() || undefined,
    propertyAddress: r.propertyAddress.trim() || undefined,
    subdivision: r.subdivisionName.trim() || undefined,
    lot: r.lotNumber.trim() || undefined,
    propertyClass: r.class || undefined,
    lastSaleDate: r.dateOfSaleShort || undefined,
    source: 'tpad',
  };
}

/**
 * TPAD's search rows and its detail page disagree about parcel id shape: the
 * row carries `parcelKey` (jur-prefixed) and `parcelId` (not), and the detail
 * endpoint needs both. Derive `parcelId` by stripping the leading jur rather
 * than trimming, which would collapse the significant padding.
 */
export function parcelIdFromKey(parcelKey: string, jur: string): string {
  return parcelKey.startsWith(jur) ? parcelKey.slice(jur.length) : parcelKey;
}

/**
 * Rebuild TPAD's fixed-width parcelKey from a ref's decomposed fields.
 *
 * Needed because refs cross sources: `lookup_parcel_by_point` returns a
 * TNMap-sourced ref whose nativeId is a GISLINK ("030098K B 00200"), which is
 * TPAD's parcelKey minus the special-interest suffix. Passing that GISLINK to
 * TPAD as a key does not error - it returns a detail page for no parcel,
 * which parses to an all-undefined record and reads to a caller as "this
 * property has no assessment data."
 *
 * Layout, verified against live rows:
 *   "030133E C 00100 000" = jur(3) cmap(5) gp(2) parcel(5) space si(3)
 *   "030142    00900 000" = same, with empty map group
 */
export function toParcelKey(ref: TnParcelRef): string {
  const cmap = ref.controlMap.padEnd(5, ' ');
  const gp = (ref.mapGroup || '').padEnd(2, ' ');
  const parcel = ref.parcel.padStart(5, '0');
  const si = (ref.specialInterest || '000').padStart(3, '0');
  return `${ref.jur.padStart(3, '0')}${cmap}${gp}${parcel} ${si}`;
}

/**
 * A ref may have been produced by any provider. Use its nativeId only when it
 * came from TPAD; otherwise rebuild, and refuse rather than guess when the
 * decomposition is too thin to rebuild from.
 */
export function tpadKeyFor(ref: TnParcelRef): string {
  if (ref.source === 'tpad' && ref.nativeId) return ref.nativeId;
  if (!ref.controlMap || !ref.parcel) {
    throw new Error(
      `Cannot build a TPAD parcel key from a ${ref.source} ref lacking control map ` +
        `and parcel number (nativeId: ${JSON.stringify(ref.nativeId)}). ` +
        `Search in this county first and use the ref from those results.`
    );
  }
  return toParcelKey(ref);
}

export const tpadAssessment: AssessmentProvider = {
  id: 'tpad',
  name: 'Tennessee Property Assessment Data (Comptroller)',
  jurs: COUNTIES.filter((c) => c.tpad).map((c) => c.jur),
  status: 'ready',
  supports: { owner: true, address: true, parcelId: true, subdivision: true, advanced: false },
  valuesOnSearch: false,

  async search(jur: string, opts: SearchOptions): Promise<ParcelSummary[]> {
    const rows = await searchProperties({
      county: jur,
      query: opts.query,
      owner: opts.owner,
      propertyAddress: opts.address,
      subdivisionName: opts.subdivision,
      parcelNumber: opts.parcelId,
    });
    // Clamp to the limit the tool schema advertises; TPAD returns its whole
    // result set and the slice is client-side.
    const limit = Math.min(Math.max(opts.limit ?? 25, 1), 200);
    return rows.slice(0, limit).map(summaryFromResult);
  },

  async getDetail(ref: TnParcelRef): Promise<ParcelDetail> {
    const parcelKey = tpadKeyFor(ref);
    const d = await getPropertyDetails({
      county: ref.jur,
      parcelId: parcelIdFromKey(parcelKey, ref.jur),
      parcelKey,
    });
    // TPAD answers an unknown key with a 200 and a shell page, which parses
    // to an all-null record. Returned as success it reads to a caller as
    // "this property has no assessment data" rather than "wrong key".
    if (!d.county && !d.ownerLines.length && !d.totalMarketAppraisal) {
      throw new Error(
        `TPAD returned no assessment record for parcel key ${JSON.stringify(parcelKey)} ` +
          `in jurisdiction ${ref.jur}. The key may be stale (TPAD reindexes by tax year) ` +
          `or from another source; search this county and use the ref from those results.`
      );
    }
    return {
      ref,
      county: d.county ?? '',
      taxYear: d.taxYear ?? undefined,
      owner: d.ownerLines[0],
      ownerSecondary: d.ownerLines[1],
      ownerMailingAddress: d.ownerLines.slice(2).join(', ') || undefined,
      propertyAddress: d.propertyAddress ?? undefined,
      subdivision: d.subdivision ?? undefined,
      lot: d.lot ?? undefined,
      propertyClass: d.propertyClass ?? undefined,
      zoning: d.zoning ?? undefined,
      landMarketValue: d.landMarketValue ?? undefined,
      improvementValue: d.improvementValue ?? undefined,
      totalMarketAppraisal: d.totalMarketAppraisal ?? undefined,
      totalAppraised: d.totalMarketAppraisal ?? undefined,
      assessedValue: d.assessment ?? undefined,
      assessmentPercentage: d.assessmentPercentage ?? undefined,
      yearBuilt: d.yearBuilt ?? undefined,
      livingAreaSqFt: d.livingAreaSqFt ?? undefined,
      stories: d.stories ?? undefined,
      condition: d.condition ?? undefined,
      exteriorWall: d.exteriorWall ?? undefined,
      heatAndAc: d.heatAndAc ?? undefined,
      sales: d.sales.map((s) => ({
        date: s.date,
        price: s.price,
        book: s.book,
        page: s.page,
        instrument: s.instrument,
        qualification: s.qualification,
        vacantImproved: s.vacantImproved,
      })),
      source: 'tpad',
      raw: d.raw,
    };
  },

  async autocomplete(jur: string, query: string): Promise<string[]> {
    return autocompleteOwner(jur, query);
  },
};
