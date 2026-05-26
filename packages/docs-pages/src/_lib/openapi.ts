import openapiSpec from '@getmunin/backend-core/openapi.json';

export type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
export const METHODS: Method[] = ['get', 'post', 'put', 'patch', 'delete'];

export interface Parameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  schema?: { type?: string; format?: string; enum?: unknown[] };
}

export interface SchemaRef {
  $ref?: string;
  type?: string | string[];
  description?: string;
  properties?: Record<string, SchemaRef>;
  required?: string[];
  items?: SchemaRef;
  format?: string;
  enum?: unknown[];
}

export interface Operation {
  operationId?: string;
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: SchemaRef }>;
  };
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: SchemaRef }> }>;
  security?: Array<Record<string, unknown[]>>;
}

export interface OpenApiDoc {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, Partial<Record<Method, Operation>>>;
  components?: { schemas?: Record<string, SchemaRef>; securitySchemes?: Record<string, unknown> };
}

export const spec = openapiSpec as unknown as OpenApiDoc;

export interface EndpointEntry {
  id: string;
  method: Method;
  path: string;
  op: Operation;
  tag: string;
  authMode: 'public' | 'bearer' | 'session' | 'bearer|session';
}

export interface TagGroup {
  tag: string;
  endpoints: EndpointEntry[];
}

export function endpointsFromSpec(source: OpenApiDoc): EndpointEntry[] {
  const out: EndpointEntry[] = [];
  for (const [path, item] of Object.entries(source.paths)) {
    if (!item) continue;
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      const tag = (op.tags && op.tags[0]) || 'Other';
      out.push({
        id: slugifyOp(method, path, op.operationId),
        method,
        path,
        op,
        tag,
        authMode: deriveAuthMode(op),
      });
    }
  }
  return out;
}

export function listEndpoints(): EndpointEntry[] {
  return endpointsFromSpec(spec);
}

export function groupByTag(endpoints: EndpointEntry[]): TagGroup[] {
  const map = new Map<string, EndpointEntry[]>();
  for (const ep of endpoints) {
    const list = map.get(ep.tag) ?? [];
    list.push(ep);
    map.set(ep.tag, list);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, endpoints]) => ({ tag, endpoints }));
}

export function findEndpoint(id: string): EndpointEntry | undefined {
  return listEndpoints().find((ep) => ep.id === id);
}

export function tagSlug(tag: string): string {
  return tag
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function prettifyTag(tag: string): string {
  return tag
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function slugifyOp(method: Method, path: string, opId?: string): string {
  if (opId) return opId;
  return `${method}-${path}`.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

function deriveAuthMode(op: Operation): EndpointEntry['authMode'] {
  if (!op.security || op.security.length === 0) return 'public';
  const schemes = new Set<string>();
  for (const block of op.security) for (const k of Object.keys(block)) schemes.add(k);
  const hasBearer = schemes.has('bearer');
  const hasSession = schemes.has('session');
  if (hasBearer && hasSession) return 'bearer|session';
  if (hasBearer) return 'bearer';
  if (hasSession) return 'session';
  return 'public';
}

export function resolveSchema(schema: SchemaRef | undefined): SchemaRef | undefined {
  if (!schema) return undefined;
  if (schema.$ref) {
    const name = schema.$ref.replace('#/components/schemas/', '');
    return spec.components?.schemas?.[name];
  }
  return schema;
}

export function requestBodyFields(op: Operation): Array<{ name: string; type: string; req: boolean; d: string }> {
  const json = op.requestBody?.content?.['application/json']?.schema;
  const resolved = resolveSchema(json);
  if (!resolved?.properties) return [];
  const required = new Set(resolved.required ?? []);
  return Object.entries(resolved.properties).map(([name, prop]) => ({
    name,
    type: typeLabel(prop),
    req: required.has(name),
    d: prop.description ?? '',
  }));
}

export function typeLabel(s: SchemaRef | undefined): string {
  if (!s) return 'unknown';
  if (s.$ref) return s.$ref.replace('#/components/schemas/', '');
  if (s.enum) return 'enum';
  if (Array.isArray(s.type)) return s.type.join(' | ');
  if (s.type === 'array') return `${typeLabel(s.items)}[]`;
  return s.type ?? 'unknown';
}
