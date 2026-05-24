import 'reflect-metadata';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';
import { McpRegistryService } from '../src/mcp/mcp.registry.js';
import { McpSkillRegistryService } from '../src/mcp/mcp.skill-registry.service.js';

process.env.DATABASE_URL ??= 'postgres://noop:noop@127.0.0.1:5432/noop';
process.env.MUNIN_AUTH_SECRET ??= 'spec-generation-do-not-use-in-prod-32chars!!';
process.env.MUNIN_KEY_PEPPER ??= 'spec-pepper';
process.env.MUNIN_EMBEDDING_PROVIDER ??= 'stub';
process.env.MUNIN_MAIL_PROVIDER ??= 'stub';
process.env.MUNIN_STORAGE_PROVIDER ??= 'local';
process.env.MUNIN_STORAGE_LOCAL_PATH ??= '/tmp/munin-docs-fixtures';
process.env.MUNIN_STORAGE_LOCAL_BASE_URL ??= 'http://127.0.0.1/static';
process.env.MUNIN_WEBHOOK_WORKER_DISABLED ??= '1';
process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED ??= '1';
process.env.MUNIN_BUILTIN_AGENT ??= '0';
process.env.MUNIN_REALTIME_DISABLED ??= '1';
process.env.MUNIN_MCP_URL ??= 'http://127.0.0.1';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.env.DOCS_FIXTURES_OUT ?? join(here, '..', 'docs-fixtures'));

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  await app.init();

  const tools = app.get(McpRegistryService);
  const skills = app.get(McpSkillRegistryService);

  const mcpTools = tools.list().map((t) => ({
    name: t.meta.name,
    title: t.meta.title,
    description: t.meta.description,
    audiences: t.meta.audiences,
    scopes: t.meta.scopes,
    danger: t.meta.destructiveHint
      ? ('destructive' as const)
      : t.meta.readOnlyHint
        ? null
        : ('writes' as const),
    readOnly: t.meta.readOnlyHint === true,
    inputSchema: t.inputJsonSchema,
  }));

  const publicSkills = skills.listPublic().map((s) => {
    const [, , module, slug] = s.uri.split('/');
    return {
      uri: s.uri,
      module: module ?? '',
      slug: slug ?? '',
      title: s.name,
      description: s.description,
      mimeType: s.mimeType,
      content: s.content,
    };
  });

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'mcp-tools.json'), JSON.stringify(mcpTools, null, 2));
  writeFileSync(join(outDir, 'skills.json'), JSON.stringify(publicSkills, null, 2));

  console.log(`wrote ${join(outDir, 'mcp-tools.json')}  (${mcpTools.length} tools)`);
  console.log(`wrote ${join(outDir, 'skills.json')}  (${publicSkills.length} skills)`);

  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
