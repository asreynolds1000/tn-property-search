# TN Property Search — MCP Server

MCP server for Tennessee property records: statewide assessment data, parcel
geometry, and per-county adapters for the counties that run their own systems.

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

## Setup

```bash
cd mcp-server
npm install
npm run build
```

Requires Node >= 20. No API keys, no accounts, no credentials.

```json
{
  "mcpServers": {
    "tn-property-search": {
      "command": "node",
      "args": ["/path/to/tn-property-search/mcp-server/dist/index.js"]
    }
  }
}
```

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
npm run check     # typecheck (incl. tests) + unit tests, no network
npx tsc --noEmit  # typecheck
```

Parser fixtures are real captured HTML with owner names and addresses replaced
by synthetic ones via `scripts/scrub-fixtures.mjs`. Substitutions are
length-preserving, because several upstream formats are fixed-width and
space-significant — a replacement of a different length shifts every field
after it and the fixture silently stops testing the real format. Replacement
surnames are verified absent from live assessment data; an invented name that
happens to be real puts a real owner back into an "anonymized" fixture.

Raw HAR captures are gitignored: they contain session cookies and tokens.

## License

MIT
