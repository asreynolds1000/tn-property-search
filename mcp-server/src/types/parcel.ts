/**
 * Canonical parcel identity and normalized records.
 *
 * Every source in this project keys parcels differently, and several encode
 * their ids in ways that break on a naive round-trip:
 *
 *   TPAD parcelKey     "030142    00900 000"      fixed-width, spaces significant
 *   TPAD hidden input  "133E%20C%2000100%20000"   URL-encoded in the HTML
 *   TNMap GISLINK      "030133E C 00100"          no special-interest suffix
 *   TNMap PARCELID     "030 133E C 00100 000 2026" carries a tax year
 *   Davidson           "060 04 0 046.00"
 *   Knox KGIS          "004  05602"
 *   Williamson PIN     "154I I 03100 00011154P"
 *
 * `TnParcelRef` is the one shape tools accept and emit. Adapters convert at
 * their own boundary and carry the source-native string in `nativeId` so a
 * follow-up call can be made without a lossy reconstruction.
 */

export interface TnParcelRef {
  /** 3-digit jurisdiction code, zero-padded. */
  jur: string;
  /** Control map, e.g. "133E". Trimmed; padding is re-applied per source. */
  controlMap: string;
  /** Map group, e.g. "C". Empty string when the source has none. */
  mapGroup: string;
  /** Parcel number, e.g. "00100". */
  parcel: string;
  /** Special interest, e.g. "000". Empty when the source omits it. */
  specialInterest: string;
  /** Exactly what the source called this parcel. Round-trip safe. */
  nativeId: string;
  /** Which adapter produced this ref. */
  source: ParcelSource;
}

export type ParcelSource = 'tpad' | 'tnmap' | 'padctn' | 'kgis' | 'williamson';

/**
 * A search hit.
 *
 * Fields are optional because the sources genuinely differ, not because the
 * parse might fail. TPAD search rows carry no valuation; PADCTN rows carry a
 * valuation but no sale date; KGIS carries address and id only unless asked
 * for more. A caller must handle absence — `source` says what to expect.
 */
export interface ParcelSummary {
  ref: TnParcelRef;
  county: string;
  owner?: string;
  /** Second owner line where the source separates them. */
  ownerSecondary?: string;
  propertyAddress?: string;
  city?: string;
  subdivision?: string;
  lot?: string;
  landUse?: string;
  propertyClass?: string;
  totalAppraised?: number;
  acres?: number;
  lastSaleDate?: string;
  lastSalePrice?: number;
  source: ParcelSource;
}

export interface ParcelSale {
  date?: string;
  price?: number | null;
  book?: string;
  page?: string;
  instrument?: string;
  qualification?: string;
  vacantImproved?: string;
}

/** Full record. Same optionality contract as ParcelSummary. */
export interface ParcelDetail extends ParcelSummary {
  taxYear?: string;
  ownerMailingAddress?: string;
  landMarketValue?: number;
  improvementValue?: number;
  totalMarketAppraisal?: number;
  assessedValue?: number;
  assessmentPercentage?: string;
  zoning?: string;
  yearBuilt?: number;
  livingAreaSqFt?: number;
  stories?: string;
  condition?: string;
  exteriorWall?: string;
  heatAndAc?: string;
  taxClass?: string;
  taxDistrict?: string;
  sales: ParcelSale[];
  /** Source-native fields this type does not name. Never dropped silently. */
  raw?: Record<string, unknown>;
}

/** GeoJSON-shaped geometry, WGS84. */
export interface ParcelGeometry {
  ref: TnParcelRef;
  /** GeoJSON Polygon or MultiPolygon coordinates. */
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] };
  acres?: number;
  source: ParcelSource;
}
