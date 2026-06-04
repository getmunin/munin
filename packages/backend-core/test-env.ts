import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function findWorkspaceRoot(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

const root = findWorkspaceRoot(process.cwd());
if (root) {
  const envPath = resolve(root, '.env');
  if (existsSync(envPath) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envPath);
  }
}

process.env.MUNIN_MCP_BURST_PER_MIN ??= '0';
