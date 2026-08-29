import { describe, it, expect } from 'vitest';
import { toGisLink, tnmapGeometryProvider } from '../lib/api/tnmap.js';
import type { TnParcelRef } from '../types/parcel.js';

const ref = (o: Partial<TnParcelRef>): TnParcelRef => ({
  jur: '030',
  controlMap: '',
  mapGroup: '',
  parcel: '',
  specialInterest: '',
  nativeId: '',
  source: 'tnmap',
  ...o,
});

// GISLINK is a fixed-width key, not a delimited one: TNMap indexes on the
// exact 15-character string, and every space is part of the value. A trimmed
// or differently-padded link matches zero features, which the caller reads as
// "no such parcel" rather than "malformed query". Every assertion here is
// exact string equality plus an explicit length, never a substring match.
describe('toGisLink', () => {
  it('builds the canonical 15-character key: jur(3) + map(5) + group(2) + parcel(5)', () => {
    const s = toGisLink(ref({ jur: '030', controlMap: '133E', mapGroup: 'C', parcel: '00100' }));
    expect(s).toBe('030133E C 00100');
    expect(s).toHaveLength(15);
  });

  it('pads a short control map on the RIGHT, keeping the group column aligned', () => {
    // '142' + 2 pad spaces, then an empty group's 2 spaces, gives the four
    // consecutive spaces seen in the real TPAD key "030142    00900 000".
    const s = toGisLink(ref({ jur: '030', controlMap: '142', mapGroup: '', parcel: '00900' }));
    expect(s).toBe('030142    00900');
    expect(s).toHaveLength(15);
  });

  it('zero-pads the parcel on the LEFT, because it is numeric', () => {
    // Parcel is the one component padded with zeroes rather than spaces;
    // padding it with spaces would produce a key that matches nothing.
    const s = toGisLink(ref({ controlMap: '133E', mapGroup: 'C', parcel: '100' }));
    expect(s).toBe('030133E C 00100');
    expect(s).toHaveLength(15);
  });

  it('adds no padding when a component is already full width', () => {
    const s = toGisLink(ref({ jur: '047', controlMap: '12345', mapGroup: 'AB', parcel: '00100' }));
    expect(s).toBe('04712345AB00100');
    expect(s).toHaveLength(15);
  });

  it('emits both space columns for an empty map group', () => {
    // The group column exists whether or not the county uses it. Collapsing it
    // shifts the parcel left by two and the lookup misses.
    const s = toGisLink(ref({ jur: '001', controlMap: '005', mapGroup: '', parcel: '00300' }));
    expect(s).toBe('001005    00300');
    expect(s).toHaveLength(15);
  });

  it('holds the 15-character width across every realistic component shape', () => {
    const cases: TnParcelRef[] = [
      ref({ jur: '030', controlMap: '133E', mapGroup: 'C', parcel: '00100' }),
      ref({ jur: '030', controlMap: '142', mapGroup: '', parcel: '00900' }),
      ref({ jur: '001', controlMap: '1', mapGroup: 'A', parcel: '1' }),
      ref({ jur: '095', controlMap: '12345', mapGroup: 'ZZ', parcel: '99999' }),
    ];
    for (const r of cases) expect(toGisLink(r)).toHaveLength(15);
  });

  it('pads rather than truncates, so an over-wide component is not silently cut', () => {
    // Documenting real behavior, not endorsing it: a caller that hands in a
    // 6-character control map gets a 16-char key that matches nothing. The
    // failure is visible (no results) rather than a wrong-parcel match, which
    // truncation could produce. Callers must supply source-shaped components.
    const s = toGisLink(ref({ controlMap: '133EXX', mapGroup: 'C', parcel: '00100' }));
    expect(s).toBe('030133EXXC 00100');
    expect(s).toHaveLength(16);
  });

  it('does not zero-pad the jurisdiction, which the ref contract must supply padded', () => {
    // TnParcelRef documents `jur` as "3-digit, zero-padded" and every adapter
    // pads it on the way in. An unpadded jur here yields a 14-char key. Pinned
    // so a future change to the ref contract cannot pass silently.
    expect(toGisLink(ref({ jur: '30', controlMap: '133E', mapGroup: 'C', parcel: '00100' })))
      .toHaveLength(14);
  });
});

describe('tnmapGeometryProvider metadata', () => {
  it('advertises itself as ready without having fetched a token', () => {
    // The ArcGIS token is lazy by design: importing this module must not open
    // a connection, or every test run and every server start hits TNMap.
    expect(tnmapGeometryProvider.status).toBe('ready');
    expect(tnmapGeometryProvider.id).toBe('tnmap');
  });
});
