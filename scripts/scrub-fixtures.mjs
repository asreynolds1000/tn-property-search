#!/usr/bin/env node
// Scrub real identities out of captured artifacts, preserving the byte geometry
// the parsers actually depend on.
//
// Why length-preserving: TPAD parcelKey ("030133E C 00100 000") and iasWorld
// PARID are fixed-width, space-padded. A naive replace that changes a field's
// length silently shifts every column after it, so the fixture stops
// exercising the real format and the parser tests pass against a shape that
// does not exist upstream.
//
// Usage: node scripts/scrub-fixtures.mjs <infile> <outfile>

import { readFileSync, writeFileSync } from 'node:fs';

const MAP_PATH = new URL('./scrub-map.local.json', import.meta.url);

function loadMap() {
  const raw = JSON.parse(readFileSync(MAP_PATH, 'utf8'));
  const pairs = [];
  for (const group of ['owners', 'addresses', 'places']) {
    for (const [from, to] of Object.entries(raw[group] ?? {})) pairs.push([from, to]);
  }
  // Longest first, so a full "SURNAME FIRST M SECOND" entry wins over the
  // bare surname that would otherwise match inside it.
  return pairs.sort((a, b) => b[0].length - a[0].length);
}

/** Pad or trim `to` so it occupies exactly as many chars as `from`. */
function fit(from, to) {
  if (to.length === from.length) return to;
  if (to.length < from.length) return to + ' '.repeat(from.length - to.length);
  return to.slice(0, from.length);
}

/**
 * Every textual form a value appears in.
 *
 * Captured pages embed the same value more than once and not always
 * literally: TPAD round-trips the search criteria through a URL-encoded JSON
 * blob in the page, so a two-word subdivision also appears with its space as
 * "%20". Scrubbing only the literal form leaves the encoded one behind, and a
 * grep for the plain string will not find it.
 */
function variants(from, to) {
  const out = [[from, fit(from, to)]];
  if (from.includes(' ')) {
    for (const [enc, label] of [['%20', 'pct20'], ['+', 'plus']]) {
      const f = from.replaceAll(' ', enc);
      const t = fit(from, to).replaceAll(' ', enc);
      // Same character count as the source form, so offsets still hold.
      if (f !== from) out.push([f, t.padEnd(f.length).slice(0, f.length)]);
      void label;
    }
  }
  return out;
}

export function scrub(text, pairs = loadMap()) {
  let out = text;
  const applied = [];
  const expanded = pairs.flatMap(([from, to]) => variants(from, to));
  // Longest first again after expansion, so encoded forms are not shadowed.
  expanded.sort((a, b) => b[0].length - a[0].length);
  for (const [from, fitted] of expanded) {
    // Case-insensitive, but only on whole runs; assessor data is upper-case.
    const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const before = out;
    out = out.replace(re, fitted);
    if (out !== before) applied.push([from, fitted]);
  }
  if (out.length !== text.length) {
    throw new Error(
      `scrub changed length ${text.length} -> ${out.length}; fixed-width fields would be corrupted`
    );
  }
  return { text: out, applied };
}

const [, , inFile, outFile] = process.argv;
if (inFile && outFile) {
  const src = readFileSync(inFile, 'utf8');
  const { text, applied } = scrub(src);
  writeFileSync(outFile, text);
  console.log(`scrubbed ${inFile} -> ${outFile}`);
  for (const [from, to] of applied) console.log(`  ${JSON.stringify(from)} -> ${JSON.stringify(to)}`);
  if (!applied.length) console.log('  (no substitutions matched - check the scrub map)');
}
