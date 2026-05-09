#!/usr/bin/env node
/**
 * Prune hashed widget bundles in apps/backend/public/widget/ that are
 * older than 7 days, EXCEPT the one currently advertised by manifest.json.
 *
 * Run from CI/cron, NOT from build (build is non-destructive — it leaves
 * older bundles around so clients caching a stale `<sha>` URL can still
 * resolve it during the deploy rollout window).
 *
 * Exit code 0 in all cases except an unreadable destination.
 */
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(SCRIPT_DIR, '..');
const DEST_DIR = resolve(BACKEND_ROOT, 'public', 'widget');
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

main();

function main() {
  if (!existsSync(DEST_DIR)) {
    console.log(`[clean-widget] no widget dir at ${DEST_DIR}, nothing to do`);
    return;
  }
  const manifestPath = join(DEST_DIR, 'manifest.json');
  let current = null;
  if (existsSync(manifestPath)) {
    try {
      const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (typeof m?.current === 'string') current = m.current;
    } catch {
      // ignore; fall through and prune by age only
    }
  }

  const now = Date.now();
  let pruned = 0;
  for (const entry of readdirSync(DEST_DIR)) {
    if (entry === 'manifest.json') continue;
    if (current && (entry === current || entry === `${current}.map`)) continue;
    if (!/^widget\.[a-f0-9]{12}\.js(\.map)?$/.test(entry)) continue;

    const filePath = join(DEST_DIR, entry);
    try {
      const info = statSync(filePath);
      if (now - info.mtimeMs > MAX_AGE_MS) {
        unlinkSync(filePath);
        pruned += 1;
      }
    } catch {
      // ignore individual file errors
    }
  }
  console.log(`[clean-widget] pruned ${pruned} stale bundle(s)`);
}
