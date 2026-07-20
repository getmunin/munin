import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { AppModule } from '../app.module.ts';
import { McpRegistryService } from './mcp.registry.ts';
import { McpSkillRegistryService } from './mcp.skill-registry.service.ts';
import { DB } from '../common/db/db.module.ts';
import { openAdminAgentMcpClient, type AgentMcpClient } from '../agent/in-process-context.ts';
import type { Db } from '@getmunin/db';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run MCP tools smoke tests.';

const EXPECTED_BY_MODULE: Record<string, RegExp> = {
  kb: /^kb_/,
  conv: /^conv_/,
  crm: /^crm_/,
  cms: /^cms_/,
  outreach: /^outreach_/,
  connectors: /^connectors_/,
  analytics: /^analytics_/,
  system: /^system_/,
  webhooks: /^webhooks_/,
  slack: /^slack_/,
};

const MIN_EXPECTED_PER_MODULE: Record<string, number> = {
  kb: 12,
  conv: 25,
  crm: 25,
  cms: 20,
  outreach: 7,
  connectors: 6,
  analytics: 6,
  system: 4,
  webhooks: 7,
  slack: 5,
};

(skipReason ? describe.skip : describe)('MCP tools smoke: registry shape across all modules', () => {
  let app: INestApplication;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let admin: AgentMcpClient;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'MCP Smoke IT Org' })
      .returning();
    orgId = org!.id;

    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();

    const registry = app.get(McpRegistryService);
    const skills = app.get(McpSkillRegistryService);
    const appDb = app.get<Db>(DB);
    admin = openAdminAgentMcpClient({ db: appDb, orgId, registry, skills });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  describe('every registered tool has a well-formed shape', () => {
    it('all tools expose a non-empty name, description, and object inputSchema', async () => {
      const tools = await admin.listTools();
      expect(tools.length).toBeGreaterThan(0);
      for (const t of tools) {
        expect(t.name, `tool with empty name in registry`).toMatch(/^[a-z][a-z0-9_]+$/);
        expect(t.name.length, `${t.name}: name exceeds 64 chars (Anthropic directory limit)`).toBeLessThanOrEqual(64);
        expect(t.description?.length ?? 0, `${t.name}: description empty`).toBeGreaterThan(0);
        const schema = t.inputSchema as { type?: string; properties?: Record<string, unknown> };
        expect(schema.type, `${t.name}: inputSchema.type must be 'object'`).toBe('object');
        expect(typeof t.annotations.title).toBe('string');
        expect(typeof t.annotations.readOnlyHint).toBe('boolean');
        expect(typeof t.annotations.destructiveHint).toBe('boolean');
      }
    });

    it('every tool is exactly one of readOnly or destructive (Anthropic directory rule)', async () => {
      const tools = await admin.listTools();
      for (const t of tools) {
        const ro = t.annotations.readOnlyHint;
        const de = t.annotations.destructiveHint;
        expect(
          ro !== de,
          `${t.name}: must set exactly one of readOnlyHint/destructiveHint to true (got readOnlyHint=${ro}, destructiveHint=${de})`,
        ).toBe(true);
      }
    });

    it('every tool name follows the <module>_<verb> convention or is a known utility', async () => {
      const tools = await admin.listTools();
      const KNOWN_PREFIXES = Object.values(EXPECTED_BY_MODULE);
      const UTILITY_TOOLS = new Set(['ping', 'skills_list', 'skills_read']);
      for (const t of tools) {
        if (UTILITY_TOOLS.has(t.name)) continue;
        const matchesAny = KNOWN_PREFIXES.some((re) => re.test(t.name));
        expect(matchesAny, `${t.name} doesn't match any known module prefix`).toBe(true);
      }
    });

    it('every tool with module prefix has a title that starts with the matching display label', async () => {
      const LABELS: Record<string, string> = {
        kb: 'KB:',
        conv: 'Conv:',
        crm: 'CRM:',
        cms: 'CMS:',
        outreach: 'Outreach:',
        connectors: 'Connectors:',
        analytics: 'Analytics:',
        system: 'System ',
        webhooks: 'Webhooks:',
        slack: 'Slack:',
      };
      const tools = await admin.listTools();
      for (const t of tools) {
        for (const [mod, re] of Object.entries(EXPECTED_BY_MODULE)) {
          if (re.test(t.name)) {
            const label = LABELS[mod]!;
            expect(
              t.annotations.title.startsWith(label),
              `${t.name}: title "${t.annotations.title}" must start with "${label}"`,
            ).toBe(true);
            break;
          }
        }
      }
    });
  });

  describe('module coverage thresholds', () => {
    for (const [mod, re] of Object.entries(EXPECTED_BY_MODULE)) {
      it(`${mod} exposes at least ${MIN_EXPECTED_PER_MODULE[mod]} tools`, async () => {
        const tools = await admin.listTools();
        const count = tools.filter((t) => re.test(t.name)).length;
        expect(count).toBeGreaterThanOrEqual(MIN_EXPECTED_PER_MODULE[mod]!);
      });
    }
  });

  describe('listing-style tools with empty inputs return cleanly for an empty org', () => {
    const SMOKE_LIST_TOOLS = [
      'kb_list_spaces',
      'conv_list_conversation_channels',
      'conv_list_conversation_topics',
      'crm_list_contacts',
      'crm_list_companies',
      'crm_list_sales_pipelines',
      'crm_list_crm_segments',
      'cms_list_collections',
      'cms_list_locales',
      'outreach_list_campaigns',
      'outreach_list_proposals',
    ];

    for (const name of SMOKE_LIST_TOOLS) {
      it(`${name} returns without isError on a fresh org`, async () => {
        const tools = await admin.listTools();
        if (!tools.some((t) => t.name === name)) {
          return;
        }
        const result = await admin.callTool(name, {});
        const dumped = JSON.stringify(result);
        expect(
          result.isError,
          `${name} returned isError on empty org. Raw: ${dumped.slice(0, 400)}`,
        ).not.toBe(true);
      });
    }
  });
});
