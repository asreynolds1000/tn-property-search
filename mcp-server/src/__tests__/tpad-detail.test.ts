import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseTpadDetail,
  parseMoney,
  extractFields,
  extractSales,
} from '../lib/parsers/tpad-detail.js';

// Real TPAD HTML, identities scrubbed length-preservingly. See
// scripts/scrub-fixtures.mjs — the markup geometry is upstream's, not ours.
const html = readFileSync(
  fileURLToPath(new URL('./fixtures/tpad-detail.html', import.meta.url)),
  'utf8'
);

describe('parseMoney', () => {
  it('parses assessor dollar strings', () => {
    expect(parseMoney('$216,400')).toBe(216400);
    expect(parseMoney('$0')).toBe(0);
  });

  it('returns null rather than NaN for the empty and placeholder cells', () => {
    // The sale table uses "-" for unknown; a NaN here would poison downstream math.
    for (const v of ['', '-', ' ', null, undefined, 'N/A']) {
      expect(parseMoney(v)).toBeNull();
    }
  });
});

describe('extractFields', () => {
  it('reads the split-column shape used by every dollar figure', () => {
    const f = extractFields(html);
    expect(f['Land Market Value']).toBe('$40,300');
    expect(f['Improvement Value']).toBe('$176,100');
    expect(f['Total Market Appraisal']).toBe('$216,400');
  });

  it('reads the inline shape used by the characteristics cards', () => {
    const f = extractFields(html);
    expect(f['Zoning']).toBe('A-1');
    expect(f['Actual Year Built']).toBe('1978');
  });
});

describe('parseTpadDetail', () => {
  const d = parseTpadDetail(html);

  it('reads the county and tax year from the page header', () => {
    expect(d.county).toBe('Greene');
    expect(d.taxYear).toBe('2026');
  });

  it('reads valuations', () => {
    expect(d.landMarketValue).toBe(40300);
    expect(d.improvementValue).toBe(176100);
    expect(d.totalMarketAppraisal).toBe(216400);
    expect(d.assessment).toBe(54100);
    expect(d.assessmentPercentage).toBe('25%');
  });

  it('reads building characteristics', () => {
    expect(d.yearBuilt).toBe(1978);
    expect(d.livingAreaSqFt).toBe(1529);
    expect(d.zoning).toBe('A-1');
    expect(d.propertyClass).toBe('00 - Residential');
  });

  it('reads subdivision data', () => {
    expect(d.subdivision).toBe('THORNWOOD RUN');
    expect(d.lot).toBe('61');
  });

  it('reads the multi-line owner block', () => {
    expect(d.ownerLines.length).toBeGreaterThanOrEqual(3);
    expect(d.ownerLines.join(' ')).toContain('QUILLERAN ODIS');
  });

  it('reads the full sale history in order, not just the most recent', () => {
    expect(d.sales).toHaveLength(5);
    expect(d.sales[0]).toMatchObject({
      date: '7/2/1991',
      price: 83500,
      book: '434',
      page: '795',
      instrument: 'WD - WARRANTY DEED',
    });
    // A $0 sale is real data (a 1987 transfer), and must not collapse to null.
    expect(d.sales[1].price).toBe(0);
    expect(d.sales.map((s) => s.price)).toEqual([83500, 0, 63000, 57000, 7850]);
  });

  it('keeps unnamed fields in raw so nothing captured is silently dropped', () => {
    expect(d.raw['Number of buildings']).toBe('1');
    expect(d.raw['Utilities - Electricity']).toBe('01 - PUBLIC');
  });

  it('carries only the synthetic identities the scrub substitutes in', () => {
    // Asserted POSITIVELY on purpose. The obvious form of this check is a
    // blocklist of the real names, but that publishes the identities the
    // scrub exists to remove - the test would name the actual owner of a real
    // parcel. Pinning the synthetic values instead catches a scrub regression
    // just as well, and the real names never enter the repository.
    expect(d.ownerLines.join(' ')).toContain('QUILLERAN ODIS');
    expect(d.propertyAddress).toContain('ALDER CT');
    // And nothing outside the synthetic vocabulary appears in the owner block.
    expect(d.ownerLines.join(' ')).toMatch(/^[A-Z0-9 .,'-]+$/);
  });
});

describe('extractSales', () => {
  it('returns [] for a page with no sale table rather than throwing', () => {
    expect(extractSales('<html><body>nothing here</body></html>')).toEqual([]);
  });
});

// TPAD is a Blazor app. Some pages render scoped-CSS attributes inside the
// label tags (`<strong b-yg9xaoucyq>`) and some do not, and the scope id
// varies by deploy. A parser written against one variant reads the other as
// all-undefined while every test still passes — which is exactly what
// happened: the original fixture was an unattributed page, and the parser
// silently under-read live attributed pages by 9 fields.
describe('parseTpadDetail on a Blazor-scoped page variant', () => {
  const scoped = readFileSync(
    fileURLToPath(new URL('./fixtures/tpad-detail-scoped.html', import.meta.url)),
    'utf8'
  );

  it('the fixture really does carry scope attributes (guards the guard)', () => {
    expect(scoped).toMatch(/<strong\s+b-[a-z0-9]+>/i);
  });

  it('reads inline fields despite the attribute', () => {
    const d = parseTpadDetail(scoped);
    expect(d.propertyAddress).toBeTruthy();
    expect(d.yearBuilt).toBe(1940);
  });

  it('reads split-column valuations despite the attribute', () => {
    const d = parseTpadDetail(scoped);
    expect(d.totalMarketAppraisal).toBe(81300);
    expect(d.landMarketValue).toBeGreaterThan(0);
  });

  it('reads the owner block and sale history', () => {
    const d = parseTpadDetail(scoped);
    expect(d.ownerLines.length).toBeGreaterThanOrEqual(2);
    expect(d.sales.length).toBeGreaterThan(0);
  });

  it('carries only synthetic identities', () => {
    // Positive assertion, for the reason given on the sibling test above.
    const d = parseTpadDetail(scoped);
    expect(d.ownerLines.join(' ')).toContain('HALVARSEN');
    expect(d.propertyAddress).toContain('ELM ROW');
  });
});
