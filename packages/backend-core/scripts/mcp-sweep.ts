/**
 * Calls every tool exposed by a live MCP server and reports pass/fail.
 *
 * Run against a populated test org to mimic what Anthropic's directory
 * reviewers do — they call every tool and verify each returns a structured
 * response (not "Internal Server Error" / generic "Bad Request").
 *
 *   MCP_URL=https://mcp.getmunin.com/mcp \
 *   MCP_TOKEN=mn_... \
 *   pnpm -F @getmunin/backend-core mcp:sweep
 *
 * Flags (env vars):
 *   MCP_URL          required — full URL of the /mcp endpoint
 *   MCP_TOKEN        required — bearer token (admin API key or session token)
 *   MCP_INCLUDE_WRITES=1   also exercise destructive tools (default: skip)
 *   MCP_ONLY=foo,bar       limit the sweep to a comma-separated allowlist
 *   MCP_SKIP=foo,bar       exclude a comma-separated denylist
 */
import 'reflect-metadata';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

interface ToolListing {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
  };
}

interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema | JsonSchema[];
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  format?: string;
  default?: unknown;
}

type Verdict = 'pass' | 'soft_fail' | 'hard_fail' | 'skipped';

interface Row {
  name: string;
  readOnly: boolean;
  verdict: Verdict;
  detail: string;
}

const MCP_URL = required('MCP_URL');
const MCP_TOKEN = required('MCP_TOKEN');
const INCLUDE_WRITES = process.env.MCP_INCLUDE_WRITES === '1';
const ONLY = parseList(process.env.MCP_ONLY);
const SKIP = parseList(process.env.MCP_SKIP);

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(2);
  }
  return v;
}

function parseList(raw: string | undefined): Set<string> | null {
  if (!raw) return null;
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

function synth(schema: JsonSchema | undefined, depth = 0): unknown {
  if (!schema || depth > 6) return undefined;
  if (schema.default !== undefined) return schema.default;
  if (schema.const !== undefined) return schema.const;
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];
  if (schema.anyOf?.length) return synth(schema.anyOf[0], depth + 1);
  if (schema.oneOf?.length) return synth(schema.oneOf[0], depth + 1);
  if (schema.allOf?.length) {
    const merged: JsonSchema = {};
    for (const s of schema.allOf) Object.assign(merged, s);
    return synth(merged, depth + 1);
  }

  const t = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (t) {
    case 'string': {
      if (schema.format === 'uuid') return '00000000-0000-0000-0000-000000000000';
      if (schema.format === 'email') return 'sweep@example.com';
      if (schema.format === 'uri' || schema.format === 'url') return 'https://example.com';
      if (schema.format === 'date-time') return new Date().toISOString();
      const min = schema.minLength ?? 1;
      return 'sweep'.padEnd(Math.max(min, 5), 'x');
    }
    case 'integer':
    case 'number':
      return schema.minimum ?? 1;
    case 'boolean':
      return false;
    case 'null':
      return null;
    case 'array': {
      const need = schema.minItems ?? 0;
      if (need === 0) return [];
      const item = Array.isArray(schema.items) ? schema.items[0] : schema.items;
      return Array.from({ length: need }, () => synth(item, depth + 1));
    }
    case 'object':
    default: {
      const out: Record<string, unknown> = {};
      const required = new Set(schema.required ?? []);
      for (const [k, v] of Object.entries(schema.properties ?? {})) {
        if (!required.has(k)) continue;
        out[k] = synth(v, depth + 1);
      }
      return out;
    }
  }
}

function classify(name: string, result: unknown, error: unknown): { verdict: Verdict; detail: string } {
  if (error) {
    const msg =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : JSON.stringify(error);
    if (/internal server error|^bad request$|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
      return { verdict: 'hard_fail', detail: truncate(msg) };
    }
    return { verdict: 'soft_fail', detail: truncate(`transport: ${msg}`) };
  }
  const r = result as { isError?: boolean; content?: Array<{ type: string; text?: string }> } | null;
  if (!r) return { verdict: 'hard_fail', detail: 'no result body' };
  const text = r.content?.[0]?.text ?? '';
  if (r.isError) {
    if (/internal server error|^bad request$/i.test(text.trim())) {
      return { verdict: 'hard_fail', detail: truncate(text) };
    }
    return { verdict: 'soft_fail', detail: truncate(text) };
  }
  return { verdict: 'pass', detail: truncate(text) };
}

function truncate(s: string): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > 140 ? `${oneLine.slice(0, 137)}…` : oneLine;
}

async function main() {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${MCP_TOKEN}` } },
  });
  const client = new Client({ name: 'munin-mcp-sweep', version: '0.1.0' }, { capabilities: {} });
  await client.connect(transport);

  const list = await client.listTools();
  const tools = list.tools as ToolListing[];
  console.log(`Discovered ${tools.length} tools at ${MCP_URL}`);

  const rows: Row[] = [];
  for (const tool of tools) {
    if (ONLY && !ONLY.has(tool.name)) continue;
    if (SKIP?.has(tool.name)) continue;

    const readOnly = tool.annotations?.readOnlyHint === true;
    if (!readOnly && !INCLUDE_WRITES) {
      rows.push({ name: tool.name, readOnly, verdict: 'skipped', detail: 'write tool — pass MCP_INCLUDE_WRITES=1' });
      continue;
    }

    const args = (synth(tool.inputSchema) as Record<string, unknown> | undefined) ?? {};
    let result: unknown = null;
    let error: unknown = null;
    try {
      result = await client.callTool({ name: tool.name, arguments: args });
    } catch (err) {
      error = err;
    }
    const { verdict, detail } = classify(tool.name, result, error);
    rows.push({ name: tool.name, readOnly, verdict, detail });
    process.stdout.write(`${verdictGlyph(verdict)} ${tool.name}\n`);
  }

  await client.close();

  console.log('\n--- Summary ---');
  const counts: Record<Verdict, number> = { pass: 0, soft_fail: 0, hard_fail: 0, skipped: 0 };
  for (const r of rows) counts[r.verdict]++;
  console.log(
    `pass=${counts.pass} soft_fail=${counts.soft_fail} hard_fail=${counts.hard_fail} skipped=${counts.skipped}`,
  );

  const failures = rows.filter((r) => r.verdict === 'hard_fail');
  if (failures.length > 0) {
    console.log('\nHard failures (review-blocking):');
    for (const r of failures) console.log(`  - ${r.name}: ${r.detail}`);
  }

  const softs = rows.filter((r) => r.verdict === 'soft_fail');
  if (softs.length > 0) {
    console.log('\nSoft failures (structured errors — confirm message is actionable):');
    for (const r of softs) console.log(`  - ${r.name}: ${r.detail}`);
  }

  process.exit(failures.length > 0 ? 1 : 0);
}

function verdictGlyph(v: Verdict): string {
  switch (v) {
    case 'pass': return '[ok]  ';
    case 'soft_fail': return '[err] ';
    case 'hard_fail': return '[FAIL]';
    case 'skipped': return '[skip]';
  }
}

main().catch((err) => {
  console.error('sweep crashed:', err);
  process.exit(2);
});
