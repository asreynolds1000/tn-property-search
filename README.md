# TN Property Search — MCP Server

[![npm](https://img.shields.io/npm/v/tn-property-search-mcp)](https://www.npmjs.com/package/tn-property-search-mcp)
[![license](https://img.shields.io/npm/l/tn-property-search-mcp)](./LICENSE)

MCP server for Tennessee property records: statewide assessment data, parcel
geometry, and per-county adapters for the counties that run their own systems.
Covers 89 of 95 counties with no API key, account, or credential of any kind.

```bash
npx -y tn-property-search-mcp
```

## Coverage

Tennessee has 95 counties. **86** are served by the Comptroller's statewide
TPAD system; the other **9** run their own CAMA systems and are listed in
TPAD's own county dropdown as external links. This server covers **89 of 95**
for both assessment and geometry.

| Counties | Assessment | Geometry |
|---|---|---|
| 86 TPAD counties | TPAD | TNMap statewide parcels |
| Davidson (019) | Metro Nashville Cadastral | Metro Nashville Cadastral |
| Knox (047) | KGIS | KGIS |
| Williamson (094) | Williamson ArcGIS Online | Williamson ArcGIS Online |
| Chester, Hamilton, Hickman, Montgomery, Rutherford, Shelby | *not yet* | *not yet* |

Flood zone lookup is national (FEMA NFHL) and works everywhere, including the
seven uncovered counties.

`search_properties` states the uncovered counties in every response, so an
empty result is never mistaken for "no such property in Tennessee."

## Tools

| Tool | Notes |
|---|---|
| `list_counties` | All 95 with jur codes and per-county provider coverage |
| `search_properties` | Owner, address, parcel ID, subdivision, or free text |
| `get_property_details` | Valuations, building characteristics, sale history |
| `get_parcel_geometry` | Boundary polygon, WGS84 GeoJSON coordinates |
| `lookup_parcel_by_point` | Coordinate → parcel |
| `autocomplete_owner` | Owner-name suggestions, TPAD counties, 3+ chars |
| `get_flood_zone` | FEMA NFHL zone, national coverage |

## Install

```bash
npm install -g tn-property-search-mcp
```

Requires Node >= 20. No API keys, no accounts, no credentials.

Add to your MCP client config:

```json
{
  "mcpServers": {
    "tn-property-search": {
      "command": "npx",
      "args": ["-y", "tn-property-search-mcp"]
    }
  }
}
```

<details>
<summary>Running from a local clone instead</summary>

```bash
git clone https://github.com/asreynolds1000/tn-property-search.git
cd tn-property-search/mcp-server
npm install
npm run build
```

```json
{
  "mcpServers": {
    "tn-property-search": {
      "command": "node",
      "args": ["/absolute/path/to/tn-property-search/mcp-server/dist/index.js"]
    }
  }
}
```

The server reads its build at startup, so rebuild and restart your client
after changing anything under `src/`.

</details>

## Data sources

| Source | Serves | Access |
|---|---|---|
| [TPAD](https://assessment.cot.tn.gov/TPAD/) — Comptroller of the Treasury | 86 counties, assessment | Public |
| [TNMap](https://tnmap.tn.gov/assessment/) — statewide parcels | 86 counties, geometry | Public, referer-bound token |
| [Metro Nashville Cadastral](https://maps.nashville.gov/) | Davidson, both | Public |
| [KGIS](https://www.kgis.org/) | Knox, both | Public, via KGIS proxy |
| Williamson County ArcGIS Online | Williamson, both | Public |
| [FEMA NFHL](https://hazards.fema.gov/) | National, flood | Public |

## Intended use and limits

This server performs **on-demand lookups of individual public records** — the
same records these offices publish for public search, retrieved one query at a
time in response to a specific question. It is a client for public data, not a
harvester:

- No bulk enumeration or crawl tools are exposed.
- Requests to a given host are serialized with a minimum interval.
- Result counts are capped per query.
- Nothing is persisted between calls; there is no local copy of any county's
  database.

Property records are public, but they concern real people. Use accordingly, and
respect each county's own terms of use.

**Knox County's assessor portal (`propertyinfo.knoxcountytn.gov`) is
deliberately not implemented.** It states terms expressly prohibiting automated
data collection, and it gates access behind a reCAPTCHA. Knox County is served
here through KGIS instead, which publishes the same assessment data as an open
GIS service without those restrictions. Do not add an iasWorld adapter to this
repository.

## Known limitations

| Limitation | Detail |
|---|---|
| Six counties uncovered | Chester, Hamilton, Hickman, Montgomery, Rutherford, Shelby |
| TNMap holds no holdout geometry | Its statewide layer returns 0 parcels for all 9 non-TPAD counties (measured, not assumed) — those route to county sources |
| Knox has no sale chain | KGIS carries the current sale only; the full history lives in iasWorld, which is not implemented |
| Knox lacks building characteristics | No year built, beds/baths, or construction detail — KGIS has square footage and land use only |
| Williamson acreage is sparse | `AC` is 0 on 78% of parcels; reported as absent rather than as 0. `Shape__Area` is not a safe substitute (Web Mercator distortion, ~9% error) |
| Davidson's server is unreliable | Metro Nashville's ArcGIS returns a 500 on ~40-50% of requests, independent of the query. Calls retry up to 6 times; a Davidson lookup is slower than the others |
| Davidson has no sale chain | The Cadastral layer carries the current transfer only. The assessor's record card at `portal.padctn.org/OFS/WP/Print/{account}/{card}` is deep-linkable and session-free if fuller history is needed |
| Zoning coverage is uneven | Present for the 86 TPAD counties and Davidson (99.97% populated); Knox and Williamson do not publish a zoning field on their parcel layers |
| Assessment values roll annually | Reappraisal cycles differ by county; a value is as-of its tax year |

## Development

```bash
cd mcp-server
npm install
npm run check     # typecheck (incl. tests) + 111 unit tests, no network
npm run build
```

`npm run typecheck` covers the test files as well as `src/`; the base
`tsconfig.json` excludes them, so a broken test import would otherwise
typecheck clean.

### Adding a county

Six counties still run their own systems with no adapter: Chester, Hamilton,
Hickman, Montgomery, Rutherford and Shelby.

Assessment and geometry are separate provider roles (`src/types/providers.ts`)
because they do not co-vary by county — Knox and Williamson serve both from
one source, Davidson needs a different one for each, and the TPAD counties
split across two. A new county implements whichever roles it can and
registers in `src/lib/registry.ts`; nothing else changes.

`src/lib/api/williamson.ts` is the simplest reference (public ArcGIS, both
roles). `PLAN.md` carries the reverse-engineering notes and the revision
history behind the architecture.

### Fixtures and PII

Parser fixtures are real captured HTML with identities replaced by synthetic
ones via `scripts/scrub-fixtures.mjs`. Three properties of that script matter:

- **Substitutions are length-preserving.** Several upstream formats are
  fixed-width and space-significant, so a replacement of a different length
  shifts every field after it and the fixture silently stops testing the real
  format. The script throws rather than emit a length-changed file.
- **Encoded variants are substituted too.** TPAD round-trips search criteria
  through a URL-encoded JSON blob in the page, so a value also appears with
  its spaces as `%20`. Scrubbing only the literal form leaves the encoded one
  behind, where a grep for the plain string will not find it.
- **Replacement surnames are verified absent from live assessment data.** An
  invented name that happens to be real puts a real owner back into an
  "anonymized" fixture — three of the first batch collided.

Tests assert *positively* on the synthetic values rather than listing the real
names in a blocklist, since a blocklist would publish the identities the scrub
exists to remove.

Raw HAR captures are gitignored: they contain session cookies and tokens.

## License

MIT
