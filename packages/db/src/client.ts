import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { parseEnvInt } from './env.ts';
import * as schema from './schema.ts';

export type Db = ReturnType<typeof createDb>;

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface CreateDbOptions {
  serviceRole?: boolean;
  poolMax?: number;
}

export function resolvePoolMax(explicit: number | undefined): number | undefined {
  if (explicit !== undefined) {
    if (!Number.isInteger(explicit) || explicit <= 0) {
      throw new Error('createDb: poolMax must be a positive integer');
    }
    return explicit;
  }
  return parseEnvInt('MUNIN_DB_POOL_MAX', { min: 1 });
}

export function createDb(connectionString: string, options: CreateDbOptions = {}) {
  const max = resolvePoolMax(options.poolMax);
  const client = postgres(connectionString, {
    prepare: false,
    ...(max !== undefined && { max }),
    ...(options.serviceRole && {
      connection: {
        options: '-c app.bypass_rls=on',
      },
    }),
  });
  return drizzle(client, { schema });
}
