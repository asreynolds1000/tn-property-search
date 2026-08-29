/**
 * Parser for TPAD's Parcel/Details page.
 *
 * The page renders labelled fields in two different shapes, and both must be
 * handled or roughly half the record silently comes back undefined:
 *
 *   inline:   <p><strong>Zoning:</strong> A-1</p>
 *   split:    <div class="col-8"><p><strong>Land Market Value:</strong></p></div>
 *             <div class="col-4 text-end"> $40,300 </div>
 *
 * The split shape is used by the Value Information card, i.e. every dollar
 * figure on the page, so an inline-only parser looks like it works while
 * dropping exactly the fields most callers want.
 */

export interface TpadSale {
  date: string;
  price: number | null;
  book: string;
  page: string;
  vacantImproved: string;
  instrument: string;
  qualification: string;
}

export interface TpadDetail {
  county: string | null;
  taxYear: string | null;
  ownerLines: string[];
  propertyAddress: string | null;
  landMarketValue: number | null;
  improvementValue: number | null;
  totalMarketAppraisal: number | null;
  assessment: number | null;
  assessmentPercentage: string | null;
  subdivision: string | null;
  lot: string | null;
  zoning: string | null;
  propertyClass: string | null;
  yearBuilt: number | null;
  livingAreaSqFt: number | null;
  stories: string | null;
  condition: string | null;
  exteriorWall: string | null;
  heatAndAc: string | null;
  sales: TpadSale[];
  /** Every label/value pair found, for fields this type does not name. */
  raw: Record<string, string>;
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, ' ');

function decode(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** "$216,400" -> 216400; "" / "-" -> null. Never returns NaN. */
export function parseMoney(v: string | null | undefined): number | null {
  if (v == null) return null;
  const cleaned = v.replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseIntOrNull(v: string | null | undefined): number | null {
  if (v == null) return null;
  const cleaned = v.replace(/[,\s]/g, '');
  if (!/^-?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Collect every labelled field on the page, in both shapes. */
export function extractFields(html: string): Record<string, string> {
  const out: Record<string, string> = {};

  // Split shape first: a label-only cell followed by its value cell.
  //
  // NOTE the `[^>]*` inside every <strong>: TPAD is a Blazor app and renders
  // scoped-CSS attributes (`<strong b-yg9xaoucyq>`) whose presence and id vary
  // by page and by deploy. A regex requiring a bare <strong> parses one
  // variant perfectly and silently returns undefined for every field on the
  // other — which is how a fixture captured from one page can make a parser
  // look correct while it under-reads live pages.
  const splitRe =
    /<div[^>]*class="[^"]*\bcol-8\b[^"]*"[^>]*>\s*<p[^>]*>\s*<strong[^>]*>([^<]+?)<\/strong>\s*<\/p>\s*<\/div>\s*<div[^>]*class="[^"]*\bcol-4\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  for (const m of html.matchAll(splitRe)) {
    const label = decode(m[1]).replace(/:$/, '');
    const value = decode(stripTags(m[2]));
    if (label) out[label] = value;
  }

  // Inline shape: <strong>Label:</strong> value, up to the closing tag.
  const inlineRe = /<strong[^>]*>\s*([^<]+?)\s*<\/strong>\s*([^<]*)</gi;
  for (const m of html.matchAll(inlineRe)) {
    const label = decode(m[1]).replace(/:$/, '');
    const value = decode(m[2]);
    if (label && value && out[label] === undefined) out[label] = value;
  }

  return out;
}

/** Rows of the Sale Information table. */
export function extractSales(html: string): TpadSale[] {
  const section = html.slice(html.search(/Sale\s+Information/i));
  if (!section) return [];
  const table = section.slice(0, section.search(/Land\s+Information/i) + 1 || undefined);
  const sales: TpadSale[] = [];
  for (const row of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) =>
      decode(stripTags(c[1]))
    );
    if (cells.length < 7) continue;
    if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(cells[0])) continue; // skip header rows
    sales.push({
      date: cells[0],
      price: parseMoney(cells[1]),
      book: cells[2],
      page: cells[3],
      vacantImproved: cells[4],
      instrument: cells[5],
      qualification: cells[6],
    });
  }
  return sales;
}

function ownerBlock(html: string): { lines: string[] } {
  // Structure is a header div followed by sibling one-line divs:
  //   <div><strong>January 1 Owner</strong></div>
  //   <div>OWNER LINE 1 </div><div>OWNER LINE 2</div><div>STREET</div>
  //   <div></div><div>CITY ST ZIP</div>
  // Anchor on the header, then take consecutive leaf divs (no nested <div>).
  const anchor = html.search(/January\s+1\s+Owner/i);
  if (anchor < 0) return { lines: [] };
  const after = html.slice(anchor);
  const close = after.indexOf('</div>');
  if (close < 0) return { lines: [] };
  const rest = after.slice(close + '</div>'.length);

  const lines: string[] = [];
  const leafDiv = /^\s*<div[^>]*>((?:(?!<div)[\s\S])*?)<\/div>/i;
  let cursor = rest;
  for (;;) {
    const m = cursor.match(leafDiv);
    if (!m) break;
    const text = decode(stripTags(m[1]));
    if (text) lines.push(text);
    cursor = cursor.slice(m[0].length);
  }
  return { lines };
}

export function parseTpadDetail(html: string): TpadDetail {
  const f = extractFields(html);
  const header = html.match(/([A-Za-z .'-]+)\s+County,\s*TN\s*\|\s*Tax\s+Year\s+(\d{4})/i);

  return {
    county: header ? header[1].trim() : null,
    taxYear: header ? header[2] : null,
    ownerLines: ownerBlock(html).lines,
    propertyAddress: f['Address'] ?? null,
    landMarketValue: parseMoney(f['Land Market Value']),
    improvementValue: parseMoney(f['Improvement Value']),
    totalMarketAppraisal: parseMoney(f['Total Market Appraisal']),
    assessment: parseMoney(f['Assessment']),
    assessmentPercentage: f['Assessment Percentage'] ?? null,
    subdivision: f['Subdivision'] ?? null,
    lot: f['Lot'] ?? null,
    zoning: f['Zoning'] ?? null,
    propertyClass: f['Class'] ?? null,
    yearBuilt: parseIntOrNull(f['Actual Year Built']),
    livingAreaSqFt: parseIntOrNull(f['Square Feet of Living Area']),
    stories: f['Stories'] ?? null,
    condition: f['Condition'] ?? null,
    exteriorWall: f['Exterior Wall'] ?? null,
    heatAndAc: f['Heat and AC'] ?? null,
    sales: extractSales(html),
    raw: f,
  };
}
