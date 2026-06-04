#!/usr/bin/env node
/**
 * Build-time copy of @getmunin/analytics-tracker's hashed bundle into the
 * backend's public/tracker/ directory. Runs as `prebuild` so the bundle
 * is in place before nest build packages dist/.
 *
 * Reads `node_modules/@getmunin/analytics-tracker/dist/manifest.json` for
 * the current hash, copies:
 *   tracker.<sha>.js      — content-hashed bundle
 *   tracker.<sha>.js.map  — sourcemap (best-effort; no error if absent)
 *   manifest.json         — { current, sha, builtAt }
 *
 * Older hashed bundles in the destination are left in place so in-flight
 * clients holding a stale `<sha>` URL can still resolve it for a while.
 *
 * Exit codes:
 *   0  – copied successfully (or no change needed).
 *   1  – source manifest / bundle missing — fail the build, don't ship a
 *        backend without a tracker asset.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(SCRIPT_DIR, '..');
const SRC_DIR = resolve(
  BACKEND_ROOT,
  'node_modules',
  '@getmunin',
  'analytics-tracker',
  'dist',
);
const DEST_DIR = resolve(BACKEND_ROOT, 'public', 'tracker');

main();

function main() {
  if (!existsSync(SRC_DIR)) {
    console.error(`[copy-tracker] missing source dir: ${SRC_DIR}`);
    console.error(
      `[copy-tracker] run \`pnpm --filter @getmunin/analytics-tracker build\` first or rely on the workspace ^build chain.`,
    );
    process.exit(1);
  }

  const manifestPath = join(SRC_DIR, 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.error(`[copy-tracker] missing manifest.json at ${manifestPath}`);
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!manifest || typeof manifest !== 'object' || typeof manifest.current !== 'string') {
    console.error(`[copy-tracker] manifest.json missing "current" field`);
    process.exit(1);
  }

  if (!/^tracker\.[a-f0-9]{12}\.js$/.test(manifest.current)) {
    console.error(
      `[copy-tracker] manifest.current does not match expected pattern: ${manifest.current}`,
    );
    process.exit(1);
  }

  const bundlePath = join(SRC_DIR, manifest.current);
  if (!existsSync(bundlePath)) {
    console.error(`[copy-tracker] bundle missing: ${bundlePath}`);
    process.exit(1);
  }

  mkdirSync(DEST_DIR, { recursive: true });

  copyFileSync(bundlePath, join(DEST_DIR, manifest.current));

  const mapPath = `${bundlePath}.map`;
  if (existsSync(mapPath)) {
    copyFileSync(mapPath, join(DEST_DIR, `${manifest.current}.map`));
  }

  writeFileSync(join(DEST_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(`[copy-tracker] copied ${manifest.current} → ${DEST_DIR}`);
}
