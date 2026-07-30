import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { DocsAppModule } from '../docs-app.module.ts';
import { McpRegistryService } from './mcp.registry.ts';

const MODULE_TITLE_PREFIX: Record<string, string> = {
  analytics: 'Analytics',
  bookings: 'Bookings',
  cms: 'CMS',
  commerce: 'Commerce',
  connectors: 'Connectors',
  conv: 'Conv',
  crm: 'CRM',
  feedback: 'Feedback',
  kb: 'KB',
  outreach: 'Outreach',
  slack: 'Slack',
  system_alerts: 'System alerts',
  webhooks: 'Webhooks',
};

const TITLE_WORDS_BY_VERB: Record<string, readonly string[]> = {
  acknowledge: ['acknowledge'],
  apply: ['apply'],
  approve: ['approve'],
  assign: ['assign'],
  bulk: ['bulk-create'],
  cancel: ['cancel'],
  change: ['change'],
  check: ['check'],
  complete: ['complete'],
  configure: ['configure'],
  create: ['create'],
  delete: ['delete'],
  disconnect: ['disconnect'],
  dismiss: ['dismiss'],
  export: ['export'],
  get: ['get', 'read'],
  import: ['import'],
  link: ['link'],
  list: ['list'],
  log: ['log'],
  lookup: ['look'],
  propose: ['propose'],
  publish: ['publish'],
  request: ['request'],
  resolve: ['resolve'],
  restore: ['restore'],
  revise: ['revise'],
  revoke: ['revoke'],
  rotate: ['rotate'],
  schedule: ['schedule'],
  search: ['search'],
  send: ['send'],
  set: ['set'],
  strip: ['strip'],
  test: ['test'],
  unlink: ['unlink'],
  unpublish: ['unpublish'],
  update: ['update'],
  upload: ['upload'],
  vote: ['vote'],
  withdraw: ['withdraw'],
};

const UNPREFIXED = new Set(['ping']);

function splitName(name: string): { module: string; verb: string } {
  const module = Object.keys(MODULE_TITLE_PREFIX).find((m) => name.startsWith(`${m}_`)) ?? '';
  const verb = name.slice(module.length + 1).split('_')[0] ?? '';
  return { module, verb };
}

describe('MCP tool naming: names, titles and verbs agree', () => {
  let app: INestApplication;
  let tools: { name: string; title?: string }[];

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgres://noop:noop@127.0.0.1:5432/noop';
    process.env.MUNIN_AUTH_SECRET ??= 'tool-naming-test-secret-not-for-prod!!';
    process.env.MUNIN_KEY_PEPPER ??= 'tool-naming-test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_STORAGE_PROVIDER = 'local';
    process.env.MUNIN_STORAGE_LOCAL_PATH = '/tmp/munin-tool-naming-test';
    process.env.MUNIN_STORAGE_LOCAL_BASE_URL = 'http://127.0.0.1/static';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED = '1';
    process.env.MUNIN_BUILTIN_AGENT = '0';
    process.env.MUNIN_REALTIME_DISABLED = '1';

    app = await NestFactory.create(DocsAppModule, { logger: false, abortOnError: false });
    await app.init();
    tools = app
      .get(McpRegistryService)
      .list()
      .map((t) => ({ name: t.meta.name, title: t.meta.title }));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('registers a non-trivial number of tools', () => {
    expect(tools.length).toBeGreaterThan(150);
  });

  it('every tool has a title', () => {
    expect(tools.filter((t) => !t.title).map((t) => t.name)).toEqual([]);
  });

  it('every tool name starts with a known module prefix', () => {
    const unknown = tools
      .filter((t) => !UNPREFIXED.has(t.name))
      .filter((t) => !splitName(t.name).module);
    expect(unknown.map((t) => t.name)).toEqual([]);
  });

  it('every title starts with its module display prefix', () => {
    const wrong = tools
      .filter((t) => !UNPREFIXED.has(t.name))
      .filter((t) => {
        const { module } = splitName(t.name);
        return module && !t.title!.startsWith(`${MODULE_TITLE_PREFIX[module]}: `);
      })
      .map((t) => `${t.name} -> ${t.title}`);
    expect(wrong).toEqual([]);
  });

  it("every title's leading word matches the verb in its name", () => {
    const mismatched = tools
      .filter((t) => !UNPREFIXED.has(t.name))
      .flatMap((t) => {
        const { module, verb } = splitName(t.name);
        if (!module) return [];
        const allowed = TITLE_WORDS_BY_VERB[verb];
        if (!allowed) return [`${t.name} -> unmapped verb '${verb}'`];
        const spoken = t
          .title!.slice(MODULE_TITLE_PREFIX[module]!.length + 2)
          .split(' ')[0]!
          .toLowerCase()
          .replace(/[^a-z-]/g, '');
        return allowed.includes(spoken) ? [] : [`${t.name} -> title says '${spoken}'`];
      });
    expect(mismatched).toEqual([]);
  });
});
