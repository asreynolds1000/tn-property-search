import { describe, it, expect } from 'vitest';
import { epochDate, whereFor, proxied, kgisAssessment, kgisGeometry } from '../lib/api/kgis.js';

describe('epochDate', () => {
  it('converts epoch millis to a YYYY-MM-DD date', () => {
    // KGIS returns SALE_DATE as epoch millis; handed through raw it renders
    // as a 13-digit number in a deed record.
    expect(epochDate(1626220800000)).toBe('2021-07-14');
    expect(epochDate(946684800000)).toBe('2000-01-01');
  });

  it('returns undefined rather than 1970-01-01 for epoch 0', () => {
    // 0 is KGIS's empty-date sentinel, not a sale on 1 January 1970. Emitting
    // that date would put a fabricated transfer into a sale history.
    expect(epochDate(0)).toBeUndefined();
  });

  it('returns undefined for missing and non-finite values', () => {
    expect(epochDate(null)).toBeUndefined();
    expect(epochDate(undefined)).toBeUndefined();
    expect(epochDate(NaN)).toBeUndefined();
    expect(epochDate(Infinity)).toBeUndefined();
  });

  it('returns undefined for a value outside the representable date range', () => {
    // Beyond +/-8.64e15 ms, Date is Invalid; without the guard this would
    // throw inside toISOString and take down the whole search.
    expect(epochDate(8.64e15 + 1)).toBeUndefined();
    expect(() => epochDate(1e20)).not.toThrow();
  });

  it('accepts a numeric STRING, because /identify returns every field as one', () => {
    // ArcGIS /query returns typed numbers but /identify returns EVERY
    // attribute as a string, so epochDate must cope with both.
    expect(epochDate('1626220800000')).toBe('2021-07-14');
  });
});

describe('proxied', () => {
  const TARGET = 'https://www.kgis.org/arcgis/rest/services/Maps/QueryTasks/MapServer/3/query';

  it('percent-encodes the ENTIRE target, query string included', () => {
    // The ArcGIS host 401s directly, so everything goes through KGIS's proxy.
    // The proxy takes one encoded component; appending params to the proxy
    // instead lets it re-parse them.
    const url = proxied(TARGET, { where: '1=0' });
    const [prefix, rest] = [url.slice(0, url.indexOf('?') + 1), url.slice(url.indexOf('?') + 1)];
    expect(prefix).toBe('https://www.kgis.org/proxy/proxy.ashx?');
    // Nothing after the proxy's own '?' may be a live delimiter.
    expect(rest).not.toContain('?');
    expect(rest).not.toContain('&');
    expect(rest).not.toContain('=');
    expect(decodeURIComponent(rest)).toBe(`${TARGET}?f=json&where=1%3D0`);
  });

  it('double-encodes % in a LIKE pattern so the proxy does not eat it', () => {
    // This is the documented failure: a single-encoded '%' is consumed by the
    // proxy as an escape and the response comes back as non-JSON, which
    // surfaces as a parse error rather than as a bad request.
    const url = proxied(TARGET, { where: "UPPER(OWNER) LIKE 'SMITH%'" });
    expect(url).toContain('%2525');
    // One decode (the proxy's) must leave a still-valid ArcGIS query string.
    const afterProxy = decodeURIComponent(url.slice(url.indexOf('?') + 1));
    const params = new URLSearchParams(afterProxy.slice(afterProxy.indexOf('?') + 1));
    expect(params.get('where')).toBe("UPPER(OWNER) LIKE 'SMITH%'");
    expect(params.get('f')).toBe('json');
  });

  it('always requests JSON, and lets a caller override nothing by accident', () => {
    expect(decodeURIComponent(proxied(TARGET, {}))).toContain('f=json');
  });
});

describe('whereFor', () => {
  it('returns 1=0 when no criteria are given, never an unbounded query', () => {
    // Knox has 210,626 parcels. A fallback that matched everything would pull
    // the county through the proxy on an empty search.
    expect(whereFor({})).toBe('1=0');
    expect(whereFor({ limit: 25 })).toBe('1=0');
  });

  it('searches the single OWNER column Knox publishes', () => {
    // Unlike Williamson, KGIS has no second owner field; asserting the exact
    // clause keeps a copy-paste from Williamson's two-column form out.
    expect(whereFor({ owner: 'smith' })).toBe("UPPER(OWNER) LIKE 'SMITH%'");
  });

  it('escapes single quotes in the SQL literal', () => {
    expect(whereFor({ owner: "O'Brien" })).toBe("UPPER(OWNER) LIKE 'O''BRIEN%'");
  });

  it('ANDs multiple criteria and reserves free text for the no-filter case', () => {
    expect(whereFor({ owner: 'smith', address: '100 main' })).toBe(
      "UPPER(OWNER) LIKE 'SMITH%' AND UPPER(FULL_ADDRESS) LIKE '100 MAIN%'"
    );
    expect(whereFor({ query: 'smith' })).toBe(
      "(UPPER(OWNER) LIKE 'SMITH%' OR UPPER(FULL_ADDRESS) LIKE 'SMITH%')"
    );
    // Asserted as an exact string, not "does not contain": whereFor uppercases
    // its input, so a substring check against the lowercase term can never fail.
    expect(whereFor({ owner: 'smith', query: 'anything' })).toBe("UPPER(OWNER) LIKE 'SMITH%'");
  });
});

describe('kgis provider metadata', () => {
  it('claims only Knox (047) for both roles', () => {
    expect(kgisAssessment.jurs).toEqual(['047']);
    expect(kgisGeometry.jurs).toEqual(['047']);
  });

  it('declares that search rows already carry valuations', () => {
    expect(kgisAssessment.valuesOnSearch).toBe(true);
  });
});
