import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { acres, whereFor, williamsonAssessment, williamsonGeometry } from '../lib/api/williamson.js';

describe('acres', () => {
  it('returns undefined for 0, which is NOT a real zero-acre parcel', () => {
    // AC is 0 on 84,334 of 107,578 Williamson parcels (78%, measured
    // 2026-08-29). Passing it through would report "0 acres" for most of the
    // county, and a caller cannot tell that apart from a genuine zero. This
    // is the single highest-consequence line in the adapter.
    expect(acres(0)).toBeUndefined();
  });

  it('returns undefined for a missing value', () => {
    expect(acres(null)).toBeUndefined();
    expect(acres(undefined)).toBeUndefined();
  });

  it('returns a real positive acreage unchanged', () => {
    expect(acres(1)).toBe(1);
    expect(acres(0.25)).toBe(0.25);
    expect(acres(1234.5678)).toBe(1234.5678);
  });

  it('drops negative and non-finite values rather than reporting them', () => {
    // A negative or NaN acreage is corrupt data. Surfacing it would put a
    // nonsense figure into a land valuation.
    expect(acres(-5)).toBeUndefined();
    expect(acres(NaN)).toBeUndefined();
    expect(acres(Infinity)).toBeUndefined();
  });

  it('accepts a numeric STRING, because /identify returns every field as one', () => {
    // ArcGIS /query returns typed numbers but /identify returns EVERY
    // attribute as a string. Rejecting strings silently dropped acreage on
    // every point lookup, so num() is deliberately string-tolerant.
    expect(acres('12.5')).toBe(12.5);
    // Still absent for empty, whitespace, and non-numeric input.
    expect(acres('')).toBeUndefined();
    expect(acres('   ')).toBeUndefined();
    expect(acres('not a number')).toBeUndefined();
    // And '0' is still an absent acreage, not a real zero (AC is 0 on 78%).
    expect(acres('0')).toBeUndefined();
  });
});

describe('whereFor', () => {
  it('returns 1=0 when no criteria are given, never an unbounded query', () => {
    // The fallback must match nothing. A truthy fallback would return the
    // whole 107,578-parcel layer on an empty search.
    expect(whereFor({})).toBe('1=0');
    expect(whereFor({ limit: 25 })).toBe('1=0');
    expect(whereFor({ owner: '', address: '' })).toBe('1=0');
  });

  it('searches BOTH owner columns, so a co-owner is not invisible', () => {
    // OWNER_2 holds the spouse or second grantee on a large share of rows.
    // Searching OWNER_1 alone silently drops those parcels from the results.
    expect(whereFor({ owner: 'smith' })).toBe(
      "(UPPER(OWNER_1) LIKE 'SMITH%' OR UPPER(OWNER_2) LIKE 'SMITH%')"
    );
  });

  it('escapes single quotes so an apostrophe cannot break out of the literal', () => {
    // O'Brien is an ordinary Tennessee surname, not an attack. Unescaped it
    // makes an invalid SQL literal and the search errors out.
    expect(whereFor({ owner: "O'Brien" })).toBe(
      "(UPPER(OWNER_1) LIKE 'O''BRIEN%' OR UPPER(OWNER_2) LIKE 'O''BRIEN%')"
    );
    expect(whereFor({ parcelId: "154I' OR '1'='1" })).toContain("''");
  });

  it('ANDs multiple criteria, so a second filter narrows rather than widens', () => {
    expect(whereFor({ address: '100 MAIN', subdivision: 'FIELDSTONE' })).toBe(
      "UPPER(ADDRESS) LIKE '100 MAIN%' AND UPPER(NEIGHBORHD) LIKE 'FIELDSTONE%'"
    );
  });

  it('uses free-text query only when no specific field was given', () => {
    // query is a scattergun across owner and address. Letting it AND into a
    // precise filter would drop rows the caller explicitly asked for.
    expect(whereFor({ query: 'smith' })).toBe(
      "(UPPER(OWNER_1) LIKE 'SMITH%' OR UPPER(ADDRESS) LIKE 'SMITH%')"
    );
    // Asserted as an exact string, not "does not contain": whereFor uppercases
    // its input, so a substring check against the lowercase term can never fail.
    expect(whereFor({ owner: 'smith', query: 'anything' })).toBe(
      "(UPPER(OWNER_1) LIKE 'SMITH%' OR UPPER(OWNER_2) LIKE 'SMITH%')"
    );
  });
});

describe('williamson provider metadata', () => {
  it('claims only Williamson (094) for both roles', () => {
    expect(williamsonAssessment.jurs).toEqual(['094']);
    expect(williamsonGeometry.jurs).toEqual(['094']);
  });

  it('declares that search rows already carry valuations', () => {
    // Unlike TPAD, one layer read yields the appraisal, so the tool layer can
    // skip a per-row detail fetch.
    expect(williamsonAssessment.valuesOnSearch).toBe(true);
  });
});

describe('opaque code fields', () => {
  // CITY, NEIGHBORHD and PROP_TYP are internal codes with no published
  // domain: CITY takes values like "701" and "263264"; the other two are
  // integers. They were briefly mapped into city/subdivision/propertyClass,
  // and a real point lookup came back with city "263264". A caller cannot
  // tell a code from a name, so these must stay out of the semantic fields
  // and live in `raw` under their source names instead.
  const src = readFileSync(
    fileURLToPath(new URL('../lib/api/williamson.ts', import.meta.url)),
    'utf8'
  );

  it('never feeds the semantic fields from the code columns', () => {
    expect(src).not.toMatch(/\bcity:\s*str\(a\.CITY\)/);
    expect(src).not.toMatch(/\bsubdivision:\s*str\(a\.NEIGHBORHD\)/);
    expect(src).not.toMatch(/\bpropertyClass:\s*str\(a\.PROP_TYP\)/);
  });

  it('still requests them, so raw can expose them honestly', () => {
    for (const f of ['CITY', 'NEIGHBORHD', 'PROP_TYP']) expect(src).toContain(`'${f}'`);
  });
});
