import { describe, it, expect } from 'vitest';
import {
  tpadKeyFor,
  toParcelKey,
  searchProperties,
  autocompleteOwner,
  getPropertyDetails,
  tpadAssessment,
  TpadUnsupportedCountyError,
} from '../lib/api/tpad.js';
import { COUNTIES } from '../lib/constants.js';

// Every case below returns or throws before any fetch is issued: the county
// guard is the first statement in each entry point, and the autocomplete
// length gate short-circuits ahead of the request. Nothing here touches the
// network.

describe('county gating', () => {
  it('refuses a holdout county with a typed error naming the adapter to use', () => {
    // Shelby is in TPAD's dropdown but disabled. Letting the call through
    // returns an empty result set that reads as "this parcel does not exist"
    // for the whole of Memphis.
    return expect(searchProperties({ county: 'Shelby', owner: 'SMITH' })).rejects.toThrow(
      TpadUnsupportedCountyError
    );
  });

  it('carries the county on the error so a caller can reroute without re-parsing', async () => {
    const err = await searchProperties({ county: '079' }).catch((e) => e);
    expect(err).toBeInstanceOf(TpadUnsupportedCountyError);
    expect(err.county.name).toBe('Shelby');
    expect(err.county.jur).toBe('079');
    expect(err.message).toContain('Shelby County');
  });

  it('rejects all nine holdouts, by name and by code', async () => {
    for (const c of COUNTIES.filter((x) => !x.tpad)) {
      await expect(searchProperties({ county: c.jur })).rejects.toBeInstanceOf(
        TpadUnsupportedCountyError
      );
      await expect(searchProperties({ county: c.name })).rejects.toBeInstanceOf(
        TpadUnsupportedCountyError
      );
    }
  });

  it('distinguishes an unknown county from a disabled one', async () => {
    // "Unknown" means a bad argument; "unsupported" means route elsewhere.
    // Collapsing the two sends the caller hunting for an adapter for a
    // county that does not exist.
    const err = await searchProperties({ county: 'Narnia' }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(TpadUnsupportedCountyError);
    expect(err.message).toMatch(/Unknown Tennessee county/);
  });

  it('gates detail lookups on the same rule as search', async () => {
    await expect(
      getPropertyDetails({ county: 'Knox', parcelId: 'x', parcelKey: 'x' })
    ).rejects.toBeInstanceOf(TpadUnsupportedCountyError);
  });
});

describe('autocompleteOwner', () => {
  it('returns [] below three characters without calling upstream', async () => {
    // TPAD's own UI enforces 3+; sending a shorter prefix returns the whole
    // county and is a needless load on a shared public service.
    expect(await autocompleteOwner('Greene', '')).toEqual([]);
    expect(await autocompleteOwner('Greene', 'ab')).toEqual([]);
    expect(await autocompleteOwner('030', 'A')).toEqual([]);
  });

  it('measures the length after trimming, not before', async () => {
    // '  a  ' is 5 characters of nothing. Counting raw length would send it.
    expect(await autocompleteOwner('Greene', '  a  ')).toEqual([]);
  });

  it('checks the county before the length, so a holdout never looks empty', async () => {
    // If the length gate ran first, autocomplete('Shelby', 'ab') would return
    // [] and read as "no owners match" instead of "wrong service".
    await expect(autocompleteOwner('Shelby', 'ab')).rejects.toBeInstanceOf(
      TpadUnsupportedCountyError
    );
  });
});

describe('tpadAssessment provider', () => {
  it('serves the 86 TPAD counties and none of the holdouts', () => {
    expect(tpadAssessment.jurs).toHaveLength(86);
    expect(tpadAssessment.jurs).toContain('030');
    expect(tpadAssessment.jurs).not.toContain('047');
    expect(tpadAssessment.jurs).not.toContain('094');
  });

  it('declares that search rows carry no valuation', () => {
    // A caller that trusts valuesOnSearch would otherwise report every TPAD
    // search hit as having a $0 appraisal.
    expect(tpadAssessment.valuesOnSearch).toBe(false);
    expect(tpadAssessment.supports.advanced).toBe(false);
  });
});

// GAP: parcelIdFromKey (deriving `parcelId` by stripping the jur prefix from
// `parcelKey`, rather than trimming, which would collapse significant padding)
// is module-private and only reachable through tpadAssessment.getDetail, which
// fetches. Left untested rather than exported.

describe('cross-source parcel refs', () => {
  it('rebuilds a TPAD key from a foreign ref instead of querying a bad one', () => {
    // lookup_parcel_by_point returns a TNMap-sourced ref whose nativeId is a
    // GISLINK — TPAD's parcelKey minus the special-interest suffix. Passing
    // that GISLINK to TPAD as a key does NOT error: TPAD serves a shell page
    // that parses to an all-undefined record, which reads to a caller as
    // "this property has no assessment data". Verified live before the fix.
    const fromTnmap = {
      jur: '030', controlMap: '098K', mapGroup: 'B', parcel: '00200',
      specialInterest: '000', nativeId: '030098K B 00200', source: 'tnmap' as const,
    };
    expect(tpadKeyFor(fromTnmap)).toBe('030098K B 00200 000');
    expect(tpadKeyFor(fromTnmap)).not.toBe(fromTnmap.nativeId);
  });

  it('passes a native TPAD ref through verbatim, padding intact', () => {
    // Padding is significant; a rebuild that differed would be a silent bug.
    const native = {
      jur: '030', controlMap: '142', mapGroup: '', parcel: '00900',
      specialInterest: '000', nativeId: '030142    00900 000', source: 'tpad' as const,
    };
    expect(tpadKeyFor(native)).toBe('030142    00900 000');
    // And the rebuild path agrees with the verbatim one for this shape.
    expect(toParcelKey(native)).toBe(native.nativeId);
  });

  it('refuses rather than guesses when a foreign ref is too thin to rebuild', () => {
    const thin = {
      jur: '030', controlMap: '', mapGroup: '', parcel: '',
      specialInterest: '', nativeId: 'whatever', source: 'kgis' as const,
    };
    expect(() => tpadKeyFor(thin)).toThrow(/Cannot build a TPAD parcel key/);
  });
});
