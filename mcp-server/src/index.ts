#!/usr/bin/env node
/**
 * TN Property Search — MCP server.
 *
 * Statewide Tennessee property records. Assessment and geometry resolve
 * through separate provider registries because they do not co-vary by county;
 * see lib/registry.ts.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { COUNTIES } from './lib/constants.js';
import {
  assessmentFor,
  countyFor,
  coverageReport,
  geometryFor,
  uncoveredCounties,
} from './lib/registry.js';
import { getFloodZone } from './lib/api/fema.js';
import type { TnParcelRef } from './types/parcel.js';

const server = new Server(
  { name: 'tn-property-search', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

/** Tools receive refs as the object emitted by search; validate before use. */
function asRef(v: unknown): TnParcelRef {
  const r = v as Partial<TnParcelRef> | undefined;
  if (!r || typeof r.jur !== 'string' || typeof r.nativeId !== 'string') {
    throw new Error(
      'Expected a parcel ref object from a prior search result ' +
        '(fields: jur, controlMap, mapGroup, parcel, specialInterest, nativeId, source).'
    );
  }
  return r as TnParcelRef;
}

const TOOLS = [
  {
    name: 'list_counties',
    description:
      'List all 95 Tennessee counties with jurisdiction codes, the assessment and geometry ' +
      'provider serving each, and which counties are not yet covered.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'search_properties',
    description:
      'Search property records in a Tennessee county by owner, address, parcel ID, or ' +
      'subdivision. Returns parcel refs usable with get_property_details and ' +
      'get_parcel_geometry. Note that some counties are not covered; the response states which.',
    inputSchema: {
      type: 'object',
      properties: {
        county: { type: 'string', description: 'County name or 3-digit jur code, e.g. "Greene" or "030".' },
        owner: { type: 'string' },
        address: { type: 'string' },
        parcelId: { type: 'string' },
        subdivision: { type: 'string' },
        query: { type: 'string', description: 'Free text, scored across owner and address.' },
        limit: { type: 'number', description: 'Default 25, max 200.' },
      },
      required: ['county'],
    },
  },
  {
    name: 'get_property_details',
    description:
      'Full assessment record for one parcel: valuations, building characteristics where the ' +
      'source has them, and sale history. Takes a ref from search_properties.',
    inputSchema: {
      type: 'object',
      properties: { ref: { type: 'object', description: 'Parcel ref from search_properties.' } },
      required: ['ref'],
    },
  },
  {
    name: 'get_parcel_geometry',
    description: 'Parcel boundary polygon in WGS84 (GeoJSON coordinates), plus acreage where recorded.',
    inputSchema: {
      type: 'object',
      properties: { ref: { type: 'object', description: 'Parcel ref from search_properties.' } },
      required: ['ref'],
    },
  },
  {
    name: 'lookup_parcel_by_point',
    description:
      'Find the parcel containing a WGS84 coordinate. A point on a street right-of-way or water ' +
      'legitimately returns no parcel.',
    inputSchema: {
      type: 'object',
      properties: {
        longitude: { type: 'number' },
        latitude: { type: 'number' },
        county: { type: 'string', description: 'Required: selects the geometry provider.' },
      },
      required: ['longitude', 'latitude', 'county'],
    },
  },
  {
    name: 'autocomplete_owner',
    description: 'Owner-name suggestions for a county. Requires 3+ characters. Not every county provider ' +
      'offers this; the response says so when it does not.',
    inputSchema: {
      type: 'object',
      properties: { county: { type: 'string' }, query: { type: 'string' } },
      required: ['county', 'query'],
    },
  },
  {
    name: 'get_flood_zone',
    description:
      'FEMA National Flood Hazard Layer zone at a WGS84 point. National coverage, so this works ' +
      'for counties whose parcel data is not yet covered.',
    inputSchema: {
      type: 'object',
      properties: { longitude: { type: 'number' }, latitude: { type: 'number' } },
      required: ['longitude', 'latitude'],
    },
  },
] as const;

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;
  const json = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 2) }] });

  try {
    switch (req.params.name) {
      case 'list_counties': {
        const cov = coverageReport();
        return json({
          ...cov,
          counties: COUNTIES.map((c) => {
            let assessment: string | null = null;
            let geometry: string | null = null;
            try { assessment = assessmentFor(c.jur).id; } catch { /* uncovered */ }
            try { geometry = geometryFor(c.jur).id; } catch { /* uncovered */ }
            return { jur: c.jur, name: c.name, assessment, geometry, covered: assessment !== null };
          }),
        });
      }

      case 'search_properties': {
        const county = countyFor(String(args.county));
        const criteria = ['owner', 'address', 'parcelId', 'subdivision', 'query'].filter(
          (k) => typeof args[k] === 'string' && (args[k] as string).trim() !== ''
        );
        if (!criteria.length) {
          throw new Error(
            'Provide at least one of: owner, address, parcelId, subdivision, query. ' +
              'A county with no criteria would return an empty result that reads as ' +
              '"no properties in this county".'
          );
        }
        const provider = assessmentFor(county.jur);
        const results = await provider.search(county.jur, {
          owner: args.owner as string | undefined,
          address: args.address as string | undefined,
          parcelId: args.parcelId as string | undefined,
          subdivision: args.subdivision as string | undefined,
          query: args.query as string | undefined,
          limit: args.limit as number | undefined,
        });
        const uncovered = uncoveredCounties();
        return json({
          county: county.name,
          provider: provider.id,
          valuesIncludedInResults: provider.valuesOnSearch,
          count: results.length,
          results,
          // Stated so an empty result is never read as "no such property in Tennessee".
          coverageNote:
            `This search covered ${county.name} County only. ` +
            `${uncovered.length} of 95 counties have no adapter yet: ` +
            uncovered.map((c) => c.name).join(', ') + '.',
        });
      }

      case 'get_property_details': {
        const ref = asRef(args.ref);
        return json(await assessmentFor(ref.jur).getDetail(ref));
      }

      case 'get_parcel_geometry': {
        const ref = asRef(args.ref);
        const g = await geometryFor(ref.jur).getGeometry(ref);
        return json(g ?? { found: false, ref });
      }

      case 'lookup_parcel_by_point': {
        const county = countyFor(String(args.county));
        const hit = await geometryFor(county.jur).lookupByPoint(
          Number(args.longitude),
          Number(args.latitude),
          county.jur
        );
        return json(hit ?? { found: false, note: 'No parcel at that point (right-of-way or water).' });
      }

      case 'autocomplete_owner': {
        const county = countyFor(String(args.county));
        const p = assessmentFor(county.jur);
        if (!p.autocomplete) {
          return json({ suggestions: [], note: `${p.name} does not provide autocomplete.` });
        }
        return json({ suggestions: await p.autocomplete(county.jur, String(args.query)) });
      }

      case 'get_flood_zone': {
        const z = await getFloodZone(Number(args.longitude), Number(args.latitude));
        return json(z ?? { found: false, note: 'No FEMA-mapped flood zone at that point.' });
      }

      default:
        throw new Error(`Unknown tool: ${req.params.name}`);
    }
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
    };
  }
});

await server.connect(new StdioServerTransport());
