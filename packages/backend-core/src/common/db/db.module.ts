import { Global, Module } from '@nestjs/common';
import { createDb, type Db } from '@getmunin/db';

export const DB = Symbol('Db');

function createServiceRoleDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  return createDb(url, { serviceRole: true });
}

@Global()
@Module({
  providers: [{ provide: DB, useFactory: createServiceRoleDb }],
  exports: [DB],
})
export class DbModule {}
