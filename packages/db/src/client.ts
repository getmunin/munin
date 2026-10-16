import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { parseEnvInt } from './env.ts';
import * as schema from './schema.ts';

export type Db = ReturnType<typeof createDb>;

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface CreateDbOptions {
  serviceRole?: boolean;
  poolMax?: number;
  idleTimeoutSeconds?: number;
  encryptionKey?: string;
}

export const DEFAULT_IDLE_TIMEOUT_SECONDS = 60;

export function resolvePoolMax(explicit: number | undefined): number | undefined {
  if (explicit !== undefined) {
    if (!Number.isInteger(explicit) || explicit <= 0) {
      throw new Error('createDb: poolMax must be a positive integer');
    }
    return explicit;
  }
  return parseEnvInt('MUNIN_DB_POOL_MAX', { min: 1 });
}

export function resolveIdleTimeoutSeconds(explicit: number | undefined): number | undefined {
  const chosen =
    explicit ?? parseEnvInt('MUNIN_DB_IDLE_TIMEOUT', { min: 0 }) ?? DEFAULT_IDLE_TIMEOUT_SECONDS;
  if (!Number.isInteger(chosen) || chosen < 0) {
    throw new Error('createDb: idleTimeoutSeconds must be a non-negative integer');
  }
  return chosen === 0 ? undefined : chosen;
}

const ENCRYPTION_KEY_SETTING = 'app.crypt_key';

export function resolveConnectionParameters(
  options: Pick<CreateDbOptions, 'serviceRole' | 'encryptionKey'>,
): Record<string, string> | undefined {
  const key = options.encryptionKey ?? process.env.MUNIN_ENCRYPTION_KEY;
  const params: Record<string, string> = {
    ...(options.serviceRole && { options: '-c app.bypass_rls=on' }),
    ...(key && { [ENCRYPTION_KEY_SETTING]: key }),
  };
  return Object.keys(params).length > 0 ? params : undefined;
}

export function createDb(connectionString: string, options: CreateDbOptions = {}) {
  const max = resolvePoolMax(options.poolMax);
  const idleTimeout = resolveIdleTimeoutSeconds(options.idleTimeoutSeconds);
  const connection = resolveConnectionParameters(options);
  const client = postgres(connectionString, {
    prepare: false,
    ...(max !== undefined && { max }),
    ...(idleTimeout !== undefined && { idle_timeout: idleTimeout }),
    ...(connection && { connection }),
  });
  return drizzle(client, { schema });
}
