# TN Property Search MCP — Implementation Plan

## Goal
Statewide Tennessee property search MCP, modeled on `~/Code/gc-property-search`.
Zero-dependency (MCP SDK only), TypeScript, vitest, hand-rolled parsers.

## Source landscape (all live-verified 2026-08-29)

| Source | Coverage | Auth | Shape |
|---|---|---|---|
| TPAD `assessment.cot.tn.gov` | 86 of 95 counties | none | JSON + HTML detail |
| TNMap `tnmap.tn.gov` | **86 TPAD counties only**, geometry | referer-bound token from `/cms/cartographs` | ArcGIS REST |
| PADCTN `portal.padctn.org` | Davidson (019) | session cookie | DevExpress HTML fragments |
| KGIS `www.kgis.org` | Knox (047), geometry | own proxy + referer | ArcGIS REST |
| Williamson `services8.arcgis.com/hkhKI6Qq7rjvBjZU` | Williamson (094), assessment **and** geometry | none | public ArcGIS Online |
| FEMA NFHL `hazards.fema.gov` | national, flood | none | ArcGIS REST, layer 28 |
| iasWorld `propertyinfo.knoxcountytn.gov` | Knox (047), assessment | session cookie + ToS accept + **reCAPTCHA** | ASP.NET WebForms |

The 9 non-TPAD counties: 012 Chester, 019 Davidson, 033 Hamilton, 041 Hickman,
047 Knox, 063 Montgomery, 075 Rutherford, 079 Shelby, 094 Williamson.

## Architecture

```
src/
  index.ts                 MCP server, tool registration
  lib/
    constants.ts           95-county table, jur codes, non-TPAD set
    http.ts                fetch wrapper: UA, referer, retry, rate limit
    registry.ts            county -> adapter resolution
    api/
      tpad.ts              statewide assessment (86 counties)
      tnmap.ts             geometry, point lookup, token bootstrap+cache
      padctn.ts            Davidson adapter
      kgis.ts              Knox geometry adapter
      knox-ias.ts          Knox assessment adapter (constrained, see below)
    parsers/
      tpad-detail.ts       TPAD Parcel/Details HTML -> typed record
      padctn-results.ts    DevExpress grid -> rows
      ias-datalet.ts       iasWorld datalet -> typed record
  types/
```

### County adapter interface
Every non-TPAD county implements the same shape, so the remaining 7 holdouts
slot in later without restructuring:

```ts
interface CountyAdapter {
  jur: string;
  name: string;
  searchByOwner(q, opts): Promise<ParcelSummary[]>;
  searchByAddress(q, opts): Promise<ParcelSummary[]>;
  getDetails(id): Promise<ParcelDetail>;
  capabilities: { advancedSearch: boolean; sketches: boolean; sales: boolean };
}
```

`ParcelSummary` / `ParcelDetail` are normalized across sources so a caller
never branches on county.

## Tools (planned)

| Tool | Backing |
|---|---|
| `list_counties` | constants |
| `search_properties` | TPAD, or county adapter when jur is a holdout |
| `get_property_details` | same routing |
| `autocomplete_owner` | TPAD |
| `get_parcel_geometry` | TNMap (all 95) / KGIS (Knox) |
| `lookup_parcel_by_point` | TNMap identify |
| `search_advanced` | PADCTN (Davidson only; capability-gated) |
| `get_flood_zone` | FEMA NFHL layer from TNMap config |

## Constraints on the Knox iasWorld adapter (deliberate)
Alex's call, 2026-08-29: this is on-demand retrieval for one property at a
time, not bulk collection. The code enforces that reading:
- no enumeration/list-all tool exposed
- serial requests to that host, never parallel
- hard result cap per query
- no on-disk persistence of Knox records between calls
- ToS session cookie is accepted once, interactively, by Alex

## Verification
- `verify:` unit tests for every parser against saved real fixtures
- `verify:` live smoke test per source, run manually, asserting a known parcel
- `verify:` `list_counties` returns exactly 95, 9 flagged non-TPAD
- Fixtures come from the real HARs, never invented HTML

---

# REVISION 1 — after cold plan review, 2026-08-29

Five claims in the original plan were wrong. Each was checked against a live
probe, not against the reviewer's assertion.

## Corrected facts

**TNMap does not cover the nine holdout counties.** Measured with a
`returnCountOnly` query against `STATEWIDE_PARCELS_WEB_MERCATOR`:

    COUNTY_ID 30 Greene (control) -> 43,053 parcels
    COUNTY_ID 19 Davidson         -> 0
    COUNTY_ID 47 Knox             -> 0
    COUNTY_ID 94 Williamson       -> 0
    COUNTY_ID 79 Shelby           -> 0

`carto.json` independently marks those nine `disabled: true`. So geometry is
NOT a single statewide source; it routes per county exactly like assessment
does. The original plan would have shipped empty geometry for every major
metro while looking like it worked.

**Flood zone has to come from FEMA directly.** The `dfirm` entry in TNMap's
config is a raster `export?...f=image` tile template; there is no attribute to
read. The queryable source is
`hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query`
(`FLD_ZONE`, `ZONE_SUBTY`, `SFHA_TF`), public and national — verified.

**Knox iasWorld is reCAPTCHA-gated.** `captcha_div` / `recaptcha_area` are
present on the disclaimer interstitial, on top of the ToS accept and an
expiring `ASP.NET_SessionId`. It therefore cannot run unattended, and no
capability flag of the form `{advancedSearch, sketches, sales}` can express
that. See "Adapter state" below.

**Tyler sketch fetch does not work as probed** (403 from
`stateoftennesseetn.atentcloud.tylerapp.com`). `sketches` is removed from
capabilities until a working request shape exists.

**Parcel IDs are not interchangeable.** Four incompatible schemes are in play
and one of them is URL-encoded in the source HTML:

    TPAD parcelKey        "030142    00900 000"   fixed-width, space-significant
    TPAD hidden input     "133E%20C%2000100%20000" URL-encoded
    TNMap GISLINK         "030133E C 00100"        no special-interest suffix
    TNMap PARCELID        "030 133E C 00100 000 2026"  carries tax year
    Davidson              "060 04 0 046.00"
    Knox KGIS             "092PL012"
    Williamson PIN        "154I I 03100 00011154P"

## Architecture changes

**1. Two provider roles per county, not one adapter.**

```ts
interface AssessmentProvider { /* search + detail */ }
interface GeometryProvider   { /* boundary + point lookup */ }
```

The registry resolves each independently. Knox is then expressible
(KGIS geometry + iasWorld assessment) instead of being a special case, and
Williamson is one object satisfying both. Geometry routing stops being
out-of-band inside `get_parcel_geometry`.

**2. TPAD is an adapter, not a special case.** It registers as the
AssessmentProvider for its 86 jurs; TNMap registers as GeometryProvider for
the same 86. `registry.ts` is the single resolution point, so routed tools
have one code path instead of two.

**3. Canonical parcel identity, defined now.** `TnParcelRef` carries
`{ jur, controlMap, mapGroup, parcel, specialInterest }` with explicit padding
rules, plus the verbatim source-native id it came from. Tools accept and emit
the canonical form; each adapter converts at its own boundary. Fixing this
after tools ship is a breaking API change, so it is fixed before any adapter
is written.

**4. Adapter state, not just capabilities.**

```ts
status: 'ready' | 'needsInteractiveSetup' | 'unavailable'
supports: { owner, address, parcelId, advanced, sales, geometry }
```

`needsInteractiveSetup` is what Knox iasWorld actually is. A typed
`NotSupported` result replaces silent empty arrays.

**5. `searchByParcelId` added.** Every source keys on map/group/parcel; it is
the most reliable lookup path and was missing.

**6. Search results carry coverage disclosure.** A statewide search backed by
TPAD omits Nashville, Memphis, Knoxville, Chattanooga, Franklin, Murfreesboro
and Clarksville. The result names the counties not searched so absence is
never read as nonexistence.

**7. Summary/detail types admit absence.** A `source` discriminator plus
explicit optionals, because the sources genuinely differ: TPAD search rows
have no values, PADCTN rows have values but no sale date, KGIS returns only
address and parcel id. Uniformity here would be a lie.

## Verification changes

- DROP "list_counties returns 95" as a correctness check. It tests the
  constants table against itself and cannot fail. Demote to a sanity check and
  ADD a reconciliation against the live `carto.json` county list (ids, names,
  and the disabled set), which can fail when the state changes something.
- ADD the two live probes that were missing and both found defects:
  holdout-county geometry coverage, and a queryable NFHL endpoint.
- Smoke tests assert IDENTITY (parcelKey, owner, control map), never values.
  TPAD is on tax year 2026 with a 2023 reappraisal; values roll annually and a
  value assertion would rot within the year.
- PREREQUISITE, previously omitted: fixture capture for Davidson detail and
  Knox datalet. Neither exists. All four captured PADCTN `WP*.html` are
  byte-identical error pages and no iasWorld datalet was ever captured, so
  those two parsers currently have nothing real to test against and must not
  be written from imagination.
