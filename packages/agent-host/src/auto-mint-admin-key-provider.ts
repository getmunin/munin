import { Injectable } from '@nestjs/common';
import {
  buildApiKey,
  encryptSecretSql,
  getCurrentContext,
  hashSecret,
  keyPrefix,
} from '@getmunin/core';
import { schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import type { AdminKeyProvider } from './admin-key-provider.js';

@Injectable()
export class AutoMintAdminKeyProvider implements AdminKeyProvider {
  async mint(configId: string): Promise<void> {
    const ctx = getCurrentContext();
    const rawKey = buildApiKey('admin');
    const [row] = await ctx.db
      .insert(schema.apiKeys)
      .values({
        orgId: configId,
        type: 'admin',
        name: 'self-service-ai-runner',
        keyHash: hashSecret(rawKey),
        keyPrefix: keyPrefix(rawKey),
        scopes: ['*'],
        audiences: ['admin', 'self_service'],
        createdByUserId: ctx.actor?.userId ?? null,
      })
      .returning({ id: schema.apiKeys.id });
    if (!row) throw new Error('failed to mint runner admin key');
    await ctx.db.execute(
      sql`UPDATE agent_config
          SET admin_api_key_ct = ${encryptSecretSql(rawKey)},
              admin_api_key_id = ${row.id},
              updated_at = now()
          WHERE id = ${configId}`,
    );
  }

  async revoke(configId: string, adminApiKeyId: string): Promise<void> {
    const ctx = getCurrentContext();
    await ctx.db.execute(
      sql`UPDATE api_keys SET revoked_at = now()
          WHERE id = ${adminApiKeyId} AND org_id = ${configId} AND revoked_at IS NULL`,
    );
    await ctx.db.execute(
      sql`UPDATE agent_config
          SET admin_api_key_ct = NULL, admin_api_key_id = NULL, updated_at = now()
          WHERE id = ${configId}`,
    );
  }
}
