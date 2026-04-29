import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Db = ReturnType<typeof createDb>;

/**
 * A drizzle transaction handle (the value passed to `db.transaction(tx => …)`).
 * Has the same query methods as `Db` plus `rollback()`. Helpers that need to
 * accept either should type their argument as `Db | Tx`.
 */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface CreateDbOptions {
  /**
   * If true, every connection in this pool starts with `app.bypass_rls = 'on'`
   * at the session level. The TenancyInterceptor still overrides it per
   * request via transaction-local `set_config(..., true)` so RLS policies
   * apply during real tenant work.
   *
   * Use this for the "service-role" Db (auth resolution, scheduled jobs,
   * background workers) that needs to read across orgs before a tenant
   * context is established.
   */
  serviceRole?: boolean;
}

export function createDb(connectionString: string, options: CreateDbOptions = {}) {
  const client = postgres(connectionString, {
    prepare: false,
    ...(options.serviceRole && {
      connection: {
        options: '-c app.bypass_rls=on',
      },
    }),
  });
  return drizzle(client, { schema });
}
