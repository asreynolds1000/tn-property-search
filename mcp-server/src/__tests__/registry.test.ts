import { describe, it, expect } from 'vitest';
import {
  assessmentFor,
  geometryFor,
  countyFor,
  coverageReport,
  uncoveredCounties,
  hasAssessment,
  hasGeometry,
  NoProviderError,
} from '../lib/registry.js';
import { COUNTIES } from '../lib/constants.js';
import { tpadAssessment } from '../lib/api/tpad.js';
import { kgisAssessment } from '../lib/api/kgis.js';
import { williamsonAssessment } from '../lib/api/williamson.js';
import { tnmapGeometryProvider } from '../lib/api/tnmap.js';

describe('provider routing', () => {
  it('routes a TPAD county to TPAD for assessment and TNMap for geometry', () => {
    // The two roles do not co-vary by county, which is the whole reason they
    // resolve separately. Greene is the control case where they differ.
    expect(assessmentFor('Greene').id).toBe('tpad');
    expect(geometryFor('Greene').id).toBe('tnmap');
  });

  it('routes Knox and Williamson to their own adapters for BOTH roles', () => {
    for (const input of ['Knox', '047', 47]) expect(assessmentFor(input).id).toBe('kgis');
    expect(geometryFor('Knox').id).toBe('kgis');
    for (const input of ['Williamson', '094', 94]) expect(assessmentFor(input).id).toBe('williamson');
    expect(geometryFor('Williamson').id).toBe('williamson');
  });

  it('throws NoProviderError, not a generic error, for an uncovered county', () => {
    // The distinction matters to the caller: "we have not built this yet" is
    // recoverable guidance, while a bare Error reads as a lookup failure.
    expect(() => assessmentFor('Shelby')).toThrow(NoProviderError);
    try {
      assessmentFor('Shelby');
    } catch (e) {
      const err = e as NoProviderError;
      expect(err.role).toBe('assessment');
      expect(err.county.jur).toBe('079');
      expect(err.message).toContain('Shelby');
      expect(err.message).toContain('adapter');
    }
  });

  it('reports the role that failed, so a geometry gap is not read as no data at all', () => {
    // The two roles resolve independently, so a county can be missing one and
    // not the other. Without `role` on the error, a caller cannot tell whether
    // it lost geometry or lost everything.
    try {
      geometryFor('Shelby');
      throw new Error('expected NoProviderError');
    } catch (e) {
      expect((e as NoProviderError).role).toBe('geometry');
    }
  });

  it('distinguishes an unknown county from an uncovered one', () => {
    // A typo must not be reported as "that county runs its own system" —
    // that would send someone looking for an adapter that can never exist.
    expect(() => countyFor('Narnia')).toThrow(/Unknown Tennessee county/);
    let caught: unknown;
    try {
      assessmentFor('Narnia');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(NoProviderError);
  });
});

describe('provider jurisdiction sets', () => {
  it('claims each county at most once, so routing is not order-dependent', () => {
    // ASSESSMENT is searched with .find(), so an overlap would silently make
    // array order decide which provider serves a county.
    const all = [
      ...tpadAssessment.jurs,
      ...kgisAssessment.jurs,
      ...williamsonAssessment.jurs,
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it('keeps the nine holdout counties out of the TPAD and TNMap sets', () => {
    // Routing a holdout to TNMap returns zero features, which is
    // indistinguishable from "no such parcel". Measured 2026-08-29: Davidson,
    // Knox, Williamson and Shelby all return 0 parcels there.
    const holdouts = COUNTIES.filter((c) => !c.tpad).map((c) => c.jur);
    for (const jur of holdouts) {
      expect(tpadAssessment.jurs).not.toContain(jur);
      expect(tnmapGeometryProvider.jurs).not.toContain(jur);
    }
    expect(tpadAssessment.jurs).toHaveLength(86);
    expect(tnmapGeometryProvider.jurs).toHaveLength(86);
  });
});

describe('coverage reporting', () => {
  it('names the six counties this server cannot search', () => {
    // A statewide owner search that silently omits Memphis and Chattanooga is
    // worse than one that says so; this list is what makes the omission
    // visible to a caller.
    expect(uncoveredCounties().map((c) => c.name)).toEqual([
      'Chester', 'Hamilton', 'Hickman', 'Montgomery', 'Rutherford', 'Shelby',
    ]);
  });

  it('returns a self-consistent report', () => {
    const r = coverageReport();
    expect(r.totalCounties).toBe(95);
    expect(r.assessmentCovered).toBe(89);
    expect(r.geometryCovered).toBe(89);
    expect(r.uncovered).toHaveLength(6);
    // The arithmetic must close, or the report understates the gap.
    expect(r.totalCounties - r.assessmentCovered).toBe(r.uncovered.length);
    expect(r.uncovered[0]).toEqual({ jur: '012', name: 'Chester' });
  });

  it('agrees with the per-county predicates it is derived from', () => {
    const covered = COUNTIES.filter((c) => hasAssessment(c.jur));
    expect(covered).toHaveLength(coverageReport().assessmentCovered);
    expect(COUNTIES.filter((c) => hasGeometry(c.jur))).toHaveLength(89);
    // Every county the predicate says is covered must actually resolve.
    for (const c of covered) expect(() => assessmentFor(c.jur)).not.toThrow();
  });
});

describe('Davidson routing', () => {
  it('routes Davidson to its own provider for both roles, not to TPAD/TNMap', () => {
    // Davidson is one of the nine counties TPAD does not serve, and TNMap's
    // statewide parcel layer holds zero geometry for it (measured), so both
    // roles must resolve to the county's own Metro Nashville service.
    expect(assessmentFor('Davidson').id).toBe('davidson');
    expect(geometryFor('Davidson').id).toBe('davidson');
    expect(assessmentFor('019').id).toBe('davidson');
  });

  it('no longer reports Davidson as uncovered', () => {
    expect(uncoveredCounties().map((c) => c.name)).not.toContain('Davidson');
  });
});
