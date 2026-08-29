/**
 * FEMA National Flood Hazard Layer.
 *
 * TNMap's config advertises a `dfirm` FEMA source, but it is a raster tile
 * template (`export?...f=image`) — a PNG, with no attribute to read. The
 * queryable source is FEMA's own NFHL MapServer, layer 28 "Flood Hazard
 * Zones", which is public, unauthenticated, and national — so it covers the
 * nine holdout counties that TNMap's parcel layer does not.
 */

import { httpJson } from '../http.js';

const NFHL =
  'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query';

export interface FloodZone {
  /** FEMA zone code, e.g. "X", "AE", "A". */
  zone: string;
  /** Human-readable subtype, e.g. "AREA OF MINIMAL FLOOD HAZARD". */
  subtype?: string;
  /**
   * True when the parcel is in a Special Flood Hazard Area (FEMA's
   * `SFHA_TF` is the string "T"/"F", not a boolean).
   */
  specialFloodHazardArea: boolean;
}

interface EsriResp {
  features?: { attributes: Record<string, string | null> }[];
  error?: { message: string };
}

/** Flood zone at a WGS84 point, or null where FEMA has no mapped zone. */
export async function getFloodZone(lon: number, lat: number): Promise<FloodZone | null> {
  const qs = new URLSearchParams({
    geometry: `${lon},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF',
    returnGeometry: 'false',
    f: 'json',
  });
  const res = await httpJson<EsriResp>(`${NFHL}?${qs}`);
  if (res.error) throw new Error(`FEMA NFHL: ${res.error.message}`);
  const a = res.features?.[0]?.attributes;
  if (!a?.FLD_ZONE) return null;
  return {
    zone: a.FLD_ZONE,
    subtype: a.ZONE_SUBTY ?? undefined,
    specialFloodHazardArea: a.SFHA_TF === 'T',
  };
}
