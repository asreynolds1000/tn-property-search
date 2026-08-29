import { describe, it, expect } from 'vitest';
import { COUNTIES, NON_TPAD_JURS, resolveCounty } from '../lib/constants.js';

describe('COUNTIES table', () => {
  it('carries all 95 Tennessee counties', () => {
    // Tennessee has exactly 95 counties. A regen run that drops or duplicates
    // a row is otherwise invisible: every lookup still works, and only the
    // missing county silently stops resolving.
    expect(COUNTIES).toHaveLength(95);
  });

  it('marks exactly the nine counties that run their own CAMA system', () => {
    // The count is load-bearing: each `tpad: false` county needs an adapter,
    // and one flipped true routes a whole county to a search that returns
    // zero rows and reads as "no such parcel".
    const holdouts = COUNTIES.filter((c) => !c.tpad).map((c) => c.name);
    expect(holdouts).toEqual([
      'Chester', 'Davidson', 'Hamilton', 'Hickman', 'Knox',
      'Montgomery', 'Rutherford', 'Shelby', 'Williamson',
    ]);
    expect(NON_TPAD_JURS).toEqual(['012', '019', '033', '041', '047', '063', '075', '079', '094']);
  });

  it('uses unique, zero-padded, gapless jurisdiction codes 001-095', () => {
    // `jur` doubles as the TNMap COUNTY_ID and as the TPAD form value, so a
    // duplicate would make a Map-based lookup resolve to the wrong county
    // rather than fail.
    const jurs = COUNTIES.map((c) => c.jur);
    expect(new Set(jurs).size).toBe(95);
    expect(jurs).toEqual(
      Array.from({ length: 95 }, (_, i) => String(i + 1).padStart(3, '0'))
    );
  });

  it('has unique county names, since name is a lookup key', () => {
    expect(new Set(COUNTIES.map((c) => c.name)).size).toBe(95);
  });
});

describe('resolveCounty', () => {
  it('accepts a jurisdiction code padded, unpadded, or numeric', () => {
    // These three forms all arrive in practice: '030' from TPAD rows, 30 from
    // TNMap's CONUM, and '30' from a hand-typed tool argument.
    const greene = COUNTIES.find((c) => c.jur === '030');
    expect(resolveCounty('030')).toBe(greene);
    expect(resolveCounty('30')).toBe(greene);
    expect(resolveCounty(30)).toBe(greene);
  });

  it('accepts a county name with or without the "County" suffix, any case', () => {
    const greene = resolveCounty('030');
    for (const form of ['Greene', 'greene', 'GREENE', 'Greene County', 'greene county', '  Greene  ']) {
      expect(resolveCounty(form)).toBe(greene);
    }
  });

  it('resolves two-word county names', () => {
    // The "County" suffix is stripped with \s+county$, which must not eat the
    // internal space in a name like Van Buren.
    expect(resolveCounty('Van Buren')?.jur).toBe('088');
    expect(resolveCounty('Van Buren County')?.jur).toBe('088');
  });

  it('returns undefined for junk rather than guessing a county', () => {
    // A wrong guess here routes a search to the wrong county's data, which
    // looks like a valid result. Undefined lets the caller say "unknown".
    for (const junk of ['', '   ', 'Narnia', '999', '000', '0', 0, '0030', 'County', '30x']) {
      expect(resolveCounty(junk)).toBeUndefined();
    }
  });
});
