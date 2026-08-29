/**
 * Provider resolution.
 *
 * Assessment and geometry resolve independently, because they do not co-vary
 * by county. Every routed tool goes through here, so there is one code path
 * rather than a TPAD branch plus an adapter branch.
 */

import type { AssessmentProvider, GeometryProvider } from '../types/providers.js';
import { COUNTIES, resolveCounty, type County } from './constants.js';
import { tpadAssessment } from './api/tpad.js';
import { tnmapGeometryProvider } from './api/tnmap.js';
import { williamsonAssessment, williamsonGeometry } from './api/williamson.js';
import { kgisAssessment, kgisGeometry } from './api/kgis.js';
import { davidsonAssessment, davidsonGeometry } from './api/davidson.js';

const ASSESSMENT: AssessmentProvider[] = [
  tpadAssessment, williamsonAssessment, kgisAssessment, davidsonAssessment,
];
const GEOMETRY: GeometryProvider[] = [
  tnmapGeometryProvider, williamsonGeometry, kgisGeometry, davidsonGeometry,
];

export class NoProviderError extends Error {
  constructor(
    readonly county: County,
    readonly role: 'assessment' | 'geometry'
  ) {
    super(
      `No ${role} provider for ${county.name} County (${county.jur}). ` +
        `It runs its own system and an adapter has not been built yet.`
    );
    this.name = 'NoProviderError';
  }
}

export function countyFor(input: string | number): County {
  const c = resolveCounty(input);
  if (!c) throw new Error(`Unknown Tennessee county: ${input}`);
  return c;
}

export function assessmentFor(input: string | number): AssessmentProvider {
  const county = countyFor(input);
  const p = ASSESSMENT.find((x) => x.jurs.includes(county.jur));
  if (!p) throw new NoProviderError(county, 'assessment');
  return p;
}

export function geometryFor(input: string | number): GeometryProvider {
  const county = countyFor(input);
  const p = GEOMETRY.find((x) => x.jurs.includes(county.jur));
  if (!p) throw new NoProviderError(county, 'geometry');
  return p;
}

export function hasAssessment(jur: string): boolean {
  return ASSESSMENT.some((p) => p.jurs.includes(jur));
}
export function hasGeometry(jur: string): boolean {
  return GEOMETRY.some((p) => p.jurs.includes(jur));
}

/**
 * Counties this server cannot search, so a caller never reads absence as
 * nonexistence. A statewide owner search that silently omits Memphis and
 * Chattanooga is worse than one that says so.
 */
export function uncoveredCounties(): County[] {
  return COUNTIES.filter((c) => !hasAssessment(c.jur));
}

export function coverageReport() {
  const assessment = COUNTIES.filter((c) => hasAssessment(c.jur));
  const geometry = COUNTIES.filter((c) => hasGeometry(c.jur));
  return {
    totalCounties: COUNTIES.length,
    assessmentCovered: assessment.length,
    geometryCovered: geometry.length,
    uncovered: uncoveredCounties().map((c) => ({ jur: c.jur, name: c.name })),
  };
}
