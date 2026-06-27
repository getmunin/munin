import { schema, type Db, type Tx } from '@getmunin/db';
import { buildApiKey, hashSecret, keyPrefix, type KeyKind } from '@getmunin/core';

export interface MintApiKeyInput {
  orgId: string;
  type: KeyKind;
  name: string;
  scopes: string[];
  audiences?: string[];
  trackerId?: string;
  channelId?: string;
  createdByUserId?: string | null;
}

export interface MintedApiKey {
  id: string;
  rawKey: string;
  keyPrefix: string;
}

export async function mintApiKey(db: Db | Tx, input: MintApiKeyInput): Promise<MintedApiKey> {
  const rawKey = buildApiKey(input.type);
  const values: typeof schema.apiKeys.$inferInsert = {
    orgId: input.orgId,
    type: input.type,
    name: input.name,
    keyHash: hashSecret(rawKey),
    keyPrefix: keyPrefix(rawKey),
    scopes: input.scopes,
    createdByUserId: input.createdByUserId ?? null,
  };
  if (input.audiences) values.audiences = input.audiences;
  if (input.trackerId) values.trackerId = input.trackerId;
  if (input.channelId) values.channelId = input.channelId;
  const [row] = await db.insert(schema.apiKeys).values(values).returning();
  return { id: row!.id, rawKey, keyPrefix: row!.keyPrefix };
}
