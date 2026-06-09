import './test-env';
import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

/**
 * Tests touch a shared Postgres (RLS, migrations, multi-tenant fixtures),
 * so running test files in parallel triggers schema-catalog contention
 * during runMigrations. Serialize files; tests within a file still run in
 * their declared order.
 *
 * The SWC plugin emits TypeScript decorator metadata, which Nest's DI
 * needs to wire constructors. Vitest's default esbuild loader strips it.
 */
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
      },
    }),
  ],
  test: {
    fileParallelism: false,
    testTimeout: 30_000,
    retry: 1,
  },
});
