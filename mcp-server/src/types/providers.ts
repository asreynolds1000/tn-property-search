/**
 * Provider roles.
 *
 * Assessment and geometry are split because they do not co-vary by county:
 *
 *   86 TPAD counties  assessment TPAD        geometry TNMap
 *   Knox (047)        assessment KGIS        geometry KGIS
 *   Williamson (094)  assessment Williamson  geometry Williamson
 *   Davidson (019)    assessment PADCTN      geometry (none yet)
 *
 * A single adapter-per-county cannot express Knox or Davidson, and forces
 * geometry routing to happen out-of-band inside the tool layer.
 */

import type {
  ParcelDetail,
  ParcelGeometry,
  ParcelSummary,
  TnParcelRef,
} from './parcel.js';

/**
 * Whether a provider can run right now.
 *
 * `needsInteractiveSetup` exists because some county systems gate behind a
 * CAPTCHA or a click-through acceptance that no unattended process can
 * satisfy. Reporting that as `unavailable` would be wrong (a human can use
 * it) and reporting it as `ready` would strand the caller mid-call.
 */
export type ProviderStatus = 'ready' | 'needsInteractiveSetup' | 'unavailable';

export interface SearchSupport {
  owner: boolean;
  address: boolean;
  parcelId: boolean;
  subdivision: boolean;
  /** Range filters: value, year built, beds/baths, sale price/date. */
  advanced: boolean;
}

export interface SearchOptions {
  owner?: string;
  address?: string;
  parcelId?: string;
  subdivision?: string;
  /** Free text; providers that score across fields use this. */
  query?: string;
  limit?: number;
}

export interface AssessmentProvider {
  readonly id: string;
  readonly name: string;
  /** Jurisdiction codes this provider serves. */
  readonly jurs: readonly string[];
  readonly status: ProviderStatus;
  readonly supports: SearchSupport;
  /** True when the provider returns valuations on search rows, not just detail. */
  readonly valuesOnSearch: boolean;

  search(jur: string, opts: SearchOptions): Promise<ParcelSummary[]>;
  getDetail(ref: TnParcelRef): Promise<ParcelDetail>;
  /** Owner-name or parcel-id suggestions. Empty array when unsupported. */
  autocomplete?(jur: string, query: string): Promise<string[]>;
}

export interface GeometryProvider {
  readonly id: string;
  readonly name: string;
  readonly jurs: readonly string[];
  readonly status: ProviderStatus;

  getGeometry(ref: TnParcelRef): Promise<ParcelGeometry | null>;
  /** Parcel containing a WGS84 point, or null. */
  lookupByPoint(lon: number, lat: number, jur?: string): Promise<ParcelSummary | null>;
}
