import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Db, Tx } from '@getmunin/db';
import { decryptSecretSql, encryptSecretSql, setEncryptionKeySql } from '@getmunin/core';
import { DB } from '../db/db.module.ts';

export class SecretCipherError extends Error {}

export type RefreshOutcome<T> = { token: T } | { revoked: string };

@Injectable()
export class OutboundOAuthStore {
  constructor(@Inject(DB) private readonly rootDb?: Db) {}

  async inRootTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const rootDb = this.rootDb;
    if (!rootDb) throw new Error('root db not available');
    return rootDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      return fn(tx);
    });
  }

  async encrypt(tx: Tx, plaintext: string): Promise<string> {
    await tx.execute(setEncryptionKeySql());
    const rows = await tx.execute<{ ct: string } & Record<string, unknown>>(
      sql`SELECT ${encryptSecretSql(plaintext)} AS ct`,
    );
    const ct = rows[0]?.ct;
    if (!ct) throw new SecretCipherError('encryption failed');
    return ct;
  }

  async decrypt(tx: Tx, ciphertext: string): Promise<string> {
    await tx.execute(setEncryptionKeySql());
    const rows = await tx.execute<{ pt: string } & Record<string, unknown>>(
      sql`SELECT ${decryptSecretSql(ciphertext)} AS pt`,
    );
    const pt = rows[0]?.pt;
    if (pt === undefined || pt === null) {
      throw new SecretCipherError('stored credential could not be decrypted');
    }
    return pt;
  }

  async resolveOrMarkRevoked<T>(args: {
    attempt: () => Promise<RefreshOutcome<T>>;
    onRevoked: (reason: string) => Promise<void>;
    revokedError: (reason: string) => Error;
  }): Promise<T> {
    const outcome = await args.attempt();
    if (!('revoked' in outcome)) return outcome.token;
    await args.onRevoked(outcome.revoked);
    throw args.revokedError(outcome.revoked);
  }
}
