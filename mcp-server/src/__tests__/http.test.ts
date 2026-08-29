import { describe, it, expect } from 'vitest';
import {
  form,
  userAgentFor,
  HttpError,
  USER_AGENT,
  BROWSER_USER_AGENT,
} from '../lib/http.js';

// No test here performs a request. The per-host rate limiter (withHostLimit)
// is only reachable through httpRaw, so it is exercised indirectly in live use
// and deliberately left uncovered rather than tested against a real host.

describe('form', () => {
  it('keeps a key whose value is undefined, as an empty field', () => {
    // searchProperties builds its body from a fixed field list and passes
    // undefined for every filter the caller left out. Dropping those keys
    // instead of emptying them would change the submitted form shape, which
    // is not the same request as one with the filter cleared.
    expect(form({ Owner: 'SMITH', PropertyAddress: undefined })).toBe(
      'Owner=SMITH&PropertyAddress='
    );
  });

  it('treats null the same as undefined', () => {
    // The declared type is string | number | undefined, but the guard is
    // `v == null`, and nulls do arrive from JSON-shaped call sites.
    const params = { Owner: null } as unknown as Record<string, string | number | undefined>;
    expect(form(params)).toBe('Owner=');
  });

  it('stringifies numbers rather than dropping them', () => {
    expect(form({ Jur: 30 })).toBe('Jur=30');
    // 0 is a real value, not an absent one.
    expect(form({ Jur: 0 })).toBe('Jur=0');
  });

  it('encodes as application/x-www-form-urlencoded: space is +, & is escaped', () => {
    // The body is sent with that Content-Type, so a raw space or ampersand
    // would split the field and silently truncate an owner name.
    expect(form({ Query: 'SMITH & CO' })).toBe('Query=SMITH+%26+CO');
    expect(form({ Owner: "O'BRIEN" })).toBe('Owner=O%27BRIEN');
  });

  it('preserves key order and every empty field in a full TPAD payload', () => {
    expect(
      form({ Jur: '030', Owner: 'SMITH', SortBy: 'Owner', ControlMap: undefined, GISLink: '' })
    ).toBe('Jur=030&Owner=SMITH&SortBy=Owner&ControlMap=&GISLink=');
  });
});

describe('userAgentFor', () => {
  it('sends the browser UA to TPAD, which WAF-rejects anything else', () => {
    // Measured 2026-08-29: the Azure gateway in front of assessment.cot.tn.gov
    // 403s our identifying UA, a compatible-token variant, and curl's default.
    expect(userAgentFor('assessment.cot.tn.gov')).toBe(BROWSER_USER_AGENT);
    expect(BROWSER_USER_AGENT).toMatch(/^Mozilla\/5\.0 /);
  });

  it('sends the identifying UA to every other upstream', () => {
    // The override is scoped to the one host that forces it. Every other
    // source accepts the honest UA, and broadening it would misrepresent us
    // to hosts that never asked.
    for (const host of [
      'tnmap.tn.gov',
      'www.kgis.org',
      'services8.arcgis.com',
      'padctn.org',
    ]) {
      expect(userAgentFor(host)).toBe(USER_AGENT);
    }
    expect(USER_AGENT).toContain('tn-property-search-mcp');
  });

  it('matches the host exactly, so a lookalike domain gets no browser UA', () => {
    expect(userAgentFor('assessment.cot.tn.gov.example.com')).toBe(USER_AGENT);
    expect(userAgentFor('cot.tn.gov')).toBe(USER_AGENT);
  });

  it('matches the host as URL parses it, which is already lowercased', () => {
    // The Set lookup is case-sensitive; this is safe only because callers
    // pass `new URL(url).host`. Pinning the composition, not just the fn.
    expect(userAgentFor(new URL('https://ASSESSMENT.COT.TN.GOV/TPAD/').host)).toBe(
      BROWSER_USER_AGENT
    );
  });
});

describe('HttpError', () => {
  it('carries status, url and body separately from the message', () => {
    // Callers branch on `status` (a 403 from the WAF needs a different fix
    // than a 404), so it must survive as a field, not only inside the text.
    const e = new HttpError(403, 'https://assessment.cot.tn.gov/TPAD/', 'Forbidden');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('HttpError');
    expect(e.status).toBe(403);
    expect(e.url).toBe('https://assessment.cot.tn.gov/TPAD/');
    expect(e.bodySnippet).toBe('Forbidden');
    expect(e.message).toBe('HTTP 403 for https://assessment.cot.tn.gov/TPAD/: Forbidden');
  });

  it('truncates the body in the message but keeps it whole on the field', () => {
    // These upstreams return full HTML error pages. An untruncated message
    // floods the MCP tool result; a truncated *field* would lose the evidence.
    const body = 'x'.repeat(5000);
    const e = new HttpError(500, 'https://example.test/', body);
    expect(e.message).toHaveLength('HTTP 500 for https://example.test/: '.length + 200);
    expect(e.bodySnippet).toHaveLength(5000);
  });
});
