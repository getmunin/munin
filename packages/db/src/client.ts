import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Db = ReturnType<typeof createDb>;

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
