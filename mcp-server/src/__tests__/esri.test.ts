import { describe, it, expect } from 'vitest';
import { ringsToGeoJson, num, likeLiteral, epochDate } from '../lib/api/esri.js';

/** Shoelace; positive = counterclockwise. */
const area = (ring: number[][]) => {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return a / 2;
};

// Esri winds exteriors CLOCKWISE (negative area) and holes counterclockwise.
// RFC 7946 is the exact opposite. Measured against live TNMap data, 100% of
// parcels arrive clockwise, so this conversion runs on every single parcel.
const esriExterior = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]];        // CW
const esriHole = [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]];                // CCW
const esriSecondPart = [[20, 0], [20, 5], [25, 5], [25, 0], [20, 0]];     // CW

describe('ringsToGeoJson', () => {
  it('flips Esri clockwise exteriors to GeoJSON counterclockwise', () => {
    expect(area(esriExterior)).toBeLessThan(0); // precondition: Esri winding
    const g = ringsToGeoJson([esriExterior])!;
    expect(g.type).toBe('Polygon');
    // Without the flip, winding-aware consumers (d3-geo, Google Maps Data
    // layer, S2) read the ring as "the whole plane minus this parcel" and
    // render every parcel inverted.
    expect(area((g.coordinates as number[][][])[0])).toBeGreaterThan(0);
  });

  it('emits MultiPolygon for a multipart parcel instead of faking a hole', () => {
    // A parcel split by a road arrives as two exterior rings. Assigning them
    // straight to a Polygon makes the second ring a HOLE in the first.
    // Measured at 2.7% of a 150-parcel Greene sample.
    const g = ringsToGeoJson([esriExterior, esriSecondPart])!;
    expect(g.type).toBe('MultiPolygon');
    expect(g.coordinates).toHaveLength(2);
    expect((g.coordinates as number[][][][])[0]).toHaveLength(1);
    expect((g.coordinates as number[][][][])[1]).toHaveLength(1);
  });

  it('keeps a genuine hole attached to its own polygon', () => {
    const g = ringsToGeoJson([esriExterior, esriHole])!;
    expect(g.type).toBe('Polygon');
    expect(g.coordinates).toHaveLength(2); // exterior + hole, not two polygons
    const [ext, hole] = g.coordinates as number[][][];
    expect(area(ext)).toBeGreaterThan(0);  // exterior CCW
    expect(area(hole)).toBeLessThan(0);    // hole CW
  });

  it('assigns holes to the part they follow in a multipart feature', () => {
    const g = ringsToGeoJson([esriExterior, esriHole, esriSecondPart])!;
    expect(g.type).toBe('MultiPolygon');
    const parts = g.coordinates as number[][][][];
    expect(parts[0]).toHaveLength(2); // first part carries the hole
    expect(parts[1]).toHaveLength(1);
  });

  it('closes an unclosed ring rather than emitting invalid GeoJSON', () => {
    const open = [[0, 0], [0, 10], [10, 10], [10, 0]];
    const g = ringsToGeoJson([open])!;
    const ring = (g.coordinates as number[][][])[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('returns null for empty or degenerate input instead of a broken shape', () => {
    expect(ringsToGeoJson([])).toBeNull();
    expect(ringsToGeoJson([[[0, 0], [1, 1]]])).toBeNull(); // too few points
  });
});

describe('num', () => {
  it('accepts strings, because /identify returns every attribute as one', () => {
    // /query gives typed numbers, /identify gives strings. A number-only
    // guard silently dropped every numeric field on the identify path.
    expect(num('0.352665')).toBeCloseTo(0.352665);
    expect(num(42)).toBe(42);
  });

  it('rejects non-numeric, empty and non-finite values', () => {
    for (const v of ['', '   ', 'abc', null, undefined, NaN, Infinity]) {
      expect(num(v as never)).toBeUndefined();
    }
  });
});

describe('likeLiteral', () => {
  it('escapes wildcards so a search for "%" does not match the whole county', () => {
    expect(likeLiteral('%')).toBe('\\%');
    expect(likeLiteral('_')).toBe('\\_');
  });

  it('still doubles single quotes so the literal cannot be closed', () => {
    expect(likeLiteral("O'BRIEN")).toBe("O''BRIEN");
  });
});

describe('epochDate', () => {
  it('converts epoch millis to an ISO date', () => {
    expect(epochDate(1626220800000)).toBe('2021-07-14');
  });
  it('treats 0 and junk as absent rather than 1970-01-01', () => {
    expect(epochDate(0)).toBeUndefined();
    expect(epochDate('nope')).toBeUndefined();
  });
});
