import { zodToJsonSchema } from 'zod-to-json-schema';
import { routes } from './routes';

/** OpenAPI 3.1 document generated from the route table — the machine-readable contract for web, mobile and Phase 2 AI agents. */
export function buildOpenApi(serverUrl = '/api/v1') {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    const p = r.path.replace(/:([A-Za-z]+)/g, '{$1}');
    const params = [...r.path.matchAll(/:([A-Za-z]+)/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
    const q: any = r.query ? zodToJsonSchema(r.query, { target: 'openApi3' }) : null;
    const queryParams = q?.properties ? Object.entries(q.properties).map(([name, schema]) => ({ name, in: 'query', required: (q.required ?? []).includes(name), schema })) : [];
    const headers = r.idempotent ? [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', maxLength: 100 } }] : [];
    paths[p] = paths[p] ?? {};
    paths[p][r.method.toLowerCase()] = {
      tags: [r.tag],
      summary: r.summary,
      operationId: `${r.method.toLowerCase()}${r.path.replace(/[/:-](\w)/g, (_m, c) => c.toUpperCase())}`,
      security: r.access === 'public' ? [] : r.access === 'optional' ? [{}, { bearerAuth: [] }] : [{ bearerAuth: [] }],
      'x-required-permission': ['public', 'optional', 'auth'].includes(r.access) ? undefined : r.access,
      parameters: [...params, ...queryParams, ...headers],
      requestBody: r.body ? { required: true, content: { 'application/json': { schema: zodToJsonSchema(r.body, { target: 'openApi3' }) } } } : undefined,
      responses: {
        [String(r.status ?? 200)]: { description: 'Success' },
        '401': { $ref: '#/components/responses/Error' },
        '403': { $ref: '#/components/responses/Error' },
        '422': { $ref: '#/components/responses/Error' },
        '429': { $ref: '#/components/responses/Error' },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'RetailGeo Insights API',
      version: '1.0.0-beta',
      description: 'Phase 1 web beta API for the RetailGeo location-aware local commerce network (Desmata Inc.). All amounts are integer US cents. Distances are statute miles.',
    },
    servers: [{ url: serverUrl }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      responses: {
        Error: {
          description: 'Error envelope',
          content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} } }, requestId: { type: 'string' } } } } },
        },
      },
    },
    paths,
  };
}
