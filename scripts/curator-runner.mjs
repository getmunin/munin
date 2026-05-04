#!/usr/bin/env node
import { runAgent } from '../packages/agent-runtime/dist/index.js';
import { Client } from '../packages/agent-runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StreamableHTTPClientTransport } from '../packages/agent-runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';

const {
  MUNIN_BASE_URL = 'http://localhost:3001',
  MUNIN_ADMIN_API_KEY,
  MUNIN_PROVIDER_BASE_URL = 'https://openrouter.ai/api/v1',
  MUNIN_PROVIDER_API_KEY,
  MUNIN_MODEL = 'openai/gpt-oss-120b:free',
  CURATORS = 'kb,crm,cms',
} = process.env;

if (!MUNIN_ADMIN_API_KEY) {
  console.error('MUNIN_ADMIN_API_KEY required');
  process.exit(1);
}
if (!MUNIN_PROVIDER_API_KEY) {
  console.error('MUNIN_PROVIDER_API_KEY required');
  process.exit(1);
}

const SKILLS = {
  kb: {
    name: 'kb-curator',
    skillUri: 'skill://kb/curation',
    userPrompt:
      'Run a KB curation pass over the last 7 days of resolved-handover conversations. Follow the procedure in the skill exactly. Skip duplicates and one-off answers. File each candidate via kb_propose_curation_candidate. Stop when there are no more candidates to file.',
  },
  crm: {
    name: 'crm-hygiene-curator',
    skillUri: 'skill://crm/hygiene',
    userPrompt:
      'Run a CRM hygiene pass. Follow the skill. First fetch dismissed pairs via crm_list_merge_proposals so you do not refile rejected pairs. Then list contacts, build suspect pairs, judge each, and file high-confidence pairs as structured proposals via crm_propose_merge_candidate. Stop when there are no more new pairs to propose.',
  },
  cms: {
    name: 'cms-stale-content-curator',
    skillUri: 'skill://cms/stale-content-review',
    userPrompt:
      'Run a CMS stale-content review pass. Follow the skill. Walk each collection, judge per-collection velocity, find stale drafts, find unrefreshed published entries, find orphaned assets. Produce a structured action report grouped by recommended action. Do not execute any mutating tool — propose only.',
  },
};

const enabled = CURATORS.split(',').map((s) => s.trim()).filter(Boolean);

const transport = new StreamableHTTPClientTransport(new URL(`${MUNIN_BASE_URL.replace(/\/+$/, '')}/mcp`), {
  requestInit: { headers: { authorization: `Bearer ${MUNIN_ADMIN_API_KEY}` } },
});
const client = new Client({ name: 'curator-runner-local', version: '0.0.1' }, { capabilities: {} });
await client.connect(transport);

const adminMcp = {
  async listTools() {
    const r = await client.listTools();
    return r.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
    }));
  },
  async callTool(name, args) {
    const r = await client.callTool({ name, arguments: args });
    return { content: r.content ?? [], isError: r.isError };
  },
};

async function readSkill(uri) {
  try {
    const res = await client.readResource({ uri });
    const item = res.contents?.[0];
    if (item && 'text' in item && typeof item.text === 'string') return item.text;
    return null;
  } catch (err) {
    return null;
  }
}

for (const slug of enabled) {
  const cfg = SKILLS[slug];
  if (!cfg) {
    console.warn(`[curator] unknown curator slug: ${slug}`);
    continue;
  }
  console.log(`\n[${cfg.name}] reading ${cfg.skillUri}…`);
  const skill = await readSkill(cfg.skillUri);
  if (!skill) {
    console.warn(`[${cfg.name}] skill not found, skipping`);
    continue;
  }
  console.log(`[${cfg.name}] running pass with ${MUNIN_MODEL}…`);
  try {
    const reply = await runAgent({
      config: {
        provider: { baseUrl: MUNIN_PROVIDER_BASE_URL, apiKey: MUNIN_PROVIDER_API_KEY },
        model: MUNIN_MODEL,
        systemPrompt: skill,
        maxToolIterations: 24,
        maxHistoryChars: 32_000,
      },
      history: [
        { authorType: 'user', body: cfg.userPrompt, createdAt: new Date().toISOString() },
      ],
      mcp: adminMcp,
    });
    console.log(
      `[${cfg.name}] done — tools=${reply.toolCalls.length}, tokens=${reply.usage.totalTokens}`,
    );
    if (reply.text) {
      console.log(`[${cfg.name}] reply:\n${reply.text.slice(0, 4000)}`);
    }
  } catch (err) {
    console.error(`[${cfg.name}] failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

await client.close().catch(() => undefined);
await transport.close().catch(() => undefined);
