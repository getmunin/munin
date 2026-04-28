import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Db = ReturnType<typeof createDb>;

export function createDb(connectionString: string) {
  const client = postgres(connectionString, { prepare: false });
  return drizzle(client, { schema });
}
