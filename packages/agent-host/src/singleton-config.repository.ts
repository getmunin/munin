import { Injectable } from '@nestjs/common';
import { decryptSecretSql, encryptSecretSql, getCurrentContext } from '@getmunin/core';
import { eq, isNotNull, sql } from 'drizzle-orm';
import { agentConfig, SINGLETON_ID } from './schema.js';
import type {
  AgentConfigPatch,
  AgentConfigRepository,
  AgentConfigRow,
} from './config.repository.js';

@Injectable()
export class SingletonConfigRepository implements AgentConfigRepository {
  resolveCurrentId(): string {
    return SINGLETON_ID;
  }

  async read(id: string): Promise<AgentConfigRow> {
    assertSingleton(id);
    return readRow(SINGLETON_ID, true);
  }

  async update(id: string, patch: AgentConfigPatch): Promise<AgentConfigRow> {
    assertSingleton(id);
    await applyPatch(SINGLETON_ID, patch);
    return readRow(SINGLETON_ID, false);
  }

  async listProvisionedIds(): Promise<string[]> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ id: agentConfig.id })
      .from(agentConfig)
      .where(isNotNull(agentConfig.providerApiKeyCt))
      .limit(1);
    return rows.map((r) => r.id);
  }

  async readDecryptedProviderKey(id: string): Promise<string | null> {
    return readDecryptedKey(id, 'provider_api_key_ct');
  }

  async readDecryptedAdminKey(id: string): Promise<string | null> {
    return readDecryptedKey(id, 'admin_api_key_ct');
  }
}

function assertSingleton(id: string): void {
  if (id !== SINGLETON_ID) {
    throw new Error(`SingletonConfigRepository only handles id='${SINGLETON_ID}', got '${id}'`);
  }
}

async function readRow(id: string, createIfMissing: boolean): Promise<AgentConfigRow> {
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
      adminApiKeyId: agentConfig.adminApiKeyId,
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
      adminApiKeyId: row.adminApiKeyId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
  if (!createIfMissing) {
    throw new Error(`agent_config row missing for id='${id}'`);
  }
  await ctx.db.execute(
    sql`INSERT INTO agent_config (id) VALUES (${id}) ON CONFLICT (id) DO NOTHING`,
  );
  return readRow(id, false);
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
