import { Global, Module } from '@nestjs/common';
import { createDb, type Db } from '@munin/db';

export const DB = Symbol('Db');

/**
 * Provides a singleton Drizzle client bound to DATABASE_URL.
 *
 * This is the "service-role" Db — used by the auth layer (which must read
 * tokens before a transaction is open) and by background workers. Per-request
 * Db clients (transaction-scoped, with org_id GUC set) are obtained via
 * `getCurrentContext().db` after the TenancyInterceptor opens a transaction.
 */
@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: (): Db => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error('DATABASE_URL is required');
        // Service-role mode: session GUC `app.bypass_rls=on` so auth
        // resolution and scheduled jobs can read cross-org rows before
        // a tenant context is established. The TenancyInterceptor still
        // overrides it per request via transaction-local set_config so
        // RLS policies apply during real tenant work.
        return createDb(url, { serviceRole: true });
      },
    },
  ],
  exports: [DB],
})
export class DbModule {}
