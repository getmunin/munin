import { defineConfig } from 'vitest/config';

/**
 * Backend tests touch a shared Postgres (RLS, migrations, multi-tenant
 * fixtures), so running test files in parallel triggers schema-catalog
 * contention ("tuple concurrently updated" from CREATE EXTENSION /
 * CREATE INDEX during runMigrations). Serialize files; tests within a
 * file still run in their declared order.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
