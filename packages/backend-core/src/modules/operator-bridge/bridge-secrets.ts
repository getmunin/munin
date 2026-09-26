import { ConflictException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Db, Tx } from '@getmunin/db';
import { decryptSecretSql, encryptSecretSql, setEncryptionKeySql } from '@getmunin/core';

export async function encryptBridgeSecret(
  db: Db | Tx,
  plaintext: string,
  errorCode: string,
): Promise<string> {
  return await db.transaction(async (tx) => {
    await tx.execute(setEncryptionKeySql());
    const rows = await tx.execute<{ ct: string } & Record<string, unknown>>(
      sql`SELECT ${encryptSecretSql(plaintext)} AS ct`,
    );
    const ct = rows[0]?.ct;
    if (!ct) throw new ConflictException(errorCode);
    return ct;
  });
}

export async function decryptBridgeSecret(
  db: Db | Tx,
  ciphertext: string,
  errorCode: string,
): Promise<string> {
  return await db.transaction(async (tx) => {
    await tx.execute(setEncryptionKeySql());
    const rows = await tx.execute<{ pt: string } & Record<string, unknown>>(
      sql`SELECT ${decryptSecretSql(ciphertext)} AS pt`,
    );
    const pt = rows[0]?.pt;
    if (pt === undefined || pt === null) throw new ConflictException(errorCode);
    return pt;
  });
}
