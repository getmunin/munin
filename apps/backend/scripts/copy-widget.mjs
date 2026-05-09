#!/usr/bin/env node
/**
 * Build-time copy of @getmunin/chat-widget's hashed bundle into the
 * backend's public/widget/ directory. Runs as `prebuild` so the bundle
 * is in place before nest build packages dist/.
 *
 * Reads `node_modules/@getmunin/chat-widget/dist/manifest.json` for the
 * current hash, copies:
 *   widget.<sha>.js      — content-hashed bundle
 *   widget.<sha>.js.map  — sourcemap (best-effort; no error if absent)
 *   manifest.json        — { current, sha, builtAt }
 *
 * Older hashed bundles in the destination are left in place so in-flight
 * clients holding a stale `<sha>` URL can still resolve it for ~7 days
 * (separate clean-widget.mjs prunes them on a cron schedule).
 *
 * Exit codes:
 *   0  – copied successfully (or no change needed).
 *   1  – source manifest / bundle missing — fail the build, don't ship a
 *        backend without a widget asset.
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
  'chat-widget',
  'dist',
);
const DEST_DIR = resolve(BACKEND_ROOT, 'public', 'widget');

main();

function main() {
  if (!existsSync(SRC_DIR)) {
    console.error(`[copy-widget] missing source dir: ${SRC_DIR}`);
    console.error(
      `[copy-widget] run \`pnpm --filter @getmunin/chat-widget build\` first or rely on the workspace ^build chain.`,
    );
    process.exit(1);
  }

  const manifestPath = join(SRC_DIR, 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.error(`[copy-widget] missing manifest.json at ${manifestPath}`);
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!manifest || typeof manifest !== 'object' || typeof manifest.current !== 'string') {
    console.error(`[copy-widget] manifest.json missing "current" field`);
    process.exit(1);
  }

  if (!/^widget\.[a-f0-9]{12}\.js$/.test(manifest.current)) {
    console.error(
      `[copy-widget] manifest.current does not match expected pattern: ${manifest.current}`,
    );
    process.exit(1);
  }

  const bundlePath = join(SRC_DIR, manifest.current);
  if (!existsSync(bundlePath)) {
    console.error(`[copy-widget] bundle missing: ${bundlePath}`);
    process.exit(1);
  }

  mkdirSync(DEST_DIR, { recursive: true });

  copyFileSync(bundlePath, join(DEST_DIR, manifest.current));

  const mapPath = `${bundlePath}.map`;
  if (existsSync(mapPath)) {
    copyFileSync(mapPath, join(DEST_DIR, `${manifest.current}.map`));
  }

  // Write the manifest LAST so a partial copy never advertises a hash
  // whose bundle isn't yet on disk.
  writeFileSync(join(DEST_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(`[copy-widget] copied ${manifest.current} → ${DEST_DIR}`);
}
