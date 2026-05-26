import { Injectable } from '@nestjs/common';
import { decryptSecretSql, encryptSecretSql, getCurrentContext } from '@getmunin/core';
import { eq, isNotNull, sql } from 'drizzle-orm';
import { agentConfig } from './schema.ts';
import type {
  AgentConfigPatch,
  AgentConfigRepository,
  AgentConfigRow,
} from './config.repository.ts';

const DEFAULT_FAST_MODEL = 'anthropic/claude-haiku-4.5';
const DEFAULT_PROVIDER_BASE_URL = 'https://openrouter.ai/v1';

@Injectable()
export class PerOrgConfigRepository implements AgentConfigRepository {
  resolveCurrentId(): string {
    const actor = getCurrentContext().actor;
    if (!actor) throw new Error('PerOrgConfigRepository requires an authenticated actor');
    return actor.orgId;
  }

  resolveOrgId(id: string): Promise<string> {
    return Promise.resolve(id);
  }

  async read(id: string): Promise<AgentConfigRow> {
    return readOrMaterialize(id);
  }

  async update(id: string, patch: AgentConfigPatch): Promise<AgentConfigRow> {
    await readOrMaterialize(id);
    await applyPatch(id, patch);
    return readOrMaterialize(id);
  }

  async listProvisionedIds(): Promise<string[]> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ id: agentConfig.id })
      .from(agentConfig)
      .where(isNotNull(agentConfig.providerApiKeyCt));
    return rows.map((r) => r.id);
  }

  async readDecryptedProviderKey(id: string): Promise<string | null> {
    return readDecryptedKey(id, 'provider_api_key_ct');
  }
}

async function readOrMaterialize(id: string): Promise<AgentConfigRow> {
  const ctx = getCurrentContext();
  const rows = await ctx.db
    .select({
      id: agentConfig.id,
      fastModel: agentConfig.fastModel,
      smartModel: agentConfig.smartModel,
      providerBaseUrl: agentConfig.providerBaseUrl,
      providerKeySet: sql<boolean>`(${agentConfig.providerApiKeyCt} IS NOT NULL)`,
      maxHistoryChars: agentConfig.maxHistoryChars,
      maxToolIterations: agentConfig.maxToolIterations,
      debounceMs: agentConfig.debounceMs,
      createdAt: agentConfig.createdAt,
      updatedAt: agentConfig.updatedAt,
    })
    .from(agentConfig)
    .where(eq(agentConfig.id, id))
    .limit(1);
  const row = rows[0];
  if (row) {
    return {
      id: row.id,
      fastModel: row.fastModel,
      smartModel: row.smartModel,
      providerBaseUrl: row.providerBaseUrl,
      providerApiKeySet: row.providerKeySet,
      maxHistoryChars: row.maxHistoryChars,
      maxToolIterations: row.maxToolIterations,
      debounceMs: row.debounceMs,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
  const [created] = await ctx.db
    .insert(agentConfig)
    .values({
      id,
      fastModel: DEFAULT_FAST_MODEL,
      providerBaseUrl: DEFAULT_PROVIDER_BASE_URL,
    })
    .returning();
  if (!created) throw new Error(`failed to materialize agent_config row for id=${id}`);
  return {
    id: created.id,
    fastModel: created.fastModel,
    smartModel: created.smartModel,
    providerBaseUrl: created.providerBaseUrl,
    providerApiKeySet: false,
    maxHistoryChars: created.maxHistoryChars,
    maxToolIterations: created.maxToolIterations,
    debounceMs: created.debounceMs,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  };
}

async function applyPatch(id: string, patch: AgentConfigPatch): Promise<void> {
  const ctx = getCurrentContext();
  const setClauses: Record<string, unknown> = {};
  if (patch.fastModel !== undefined) setClauses['fastModel'] = patch.fastModel;
  if (patch.smartModel !== undefined) setClauses['smartModel'] = patch.smartModel;
  if (patch.providerBaseUrl !== undefined) setClauses['providerBaseUrl'] = patch.providerBaseUrl;
  if (patch.maxHistoryChars !== undefined) setClauses['maxHistoryChars'] = patch.maxHistoryChars;
  if (patch.maxToolIterations !== undefined) setClauses['maxToolIterations'] = patch.maxToolIterations;
  if (patch.debounceMs !== undefined) setClauses['debounceMs'] = patch.debounceMs;
  setClauses['updatedAt'] = new Date();

  if (Object.keys(setClauses).length > 1) {
    await ctx.db.update(agentConfig).set(setClauses).where(eq(agentConfig.id, id));
  }

  if (patch.providerApiKey === null) {
    await ctx.db.execute(
      sql`UPDATE agent_config SET provider_api_key_ct = NULL, updated_at = now()
          WHERE id = ${id}`,
    );
  } else if (typeof patch.providerApiKey === 'string' && patch.providerApiKey.length > 0) {
    await ctx.db.execute(
      sql`UPDATE agent_config
          SET provider_api_key_ct = ${encryptSecretSql(patch.providerApiKey)},
              updated_at = now()
          WHERE id = ${id}`,
    );
  }
}

async function readDecryptedKey(id: string, column: string): Promise<string | null> {
  const ctx = getCurrentContext();
  const colSql = sql.raw(column);
  const rows = await ctx.db.execute<{ key: string | null } & Record<string, unknown>>(
    sql`SELECT ${decryptSecretSql(colSql)} AS key
        FROM agent_config
        WHERE id = ${id} AND ${colSql} IS NOT NULL
        LIMIT 1`,
  );
  return rows[0]?.key ?? null;
}
