import { resolve, relative, dirname } from 'node:path';
import { existsSync } from 'node:fs';

function packageRootFor(filePath) {
  let dir = dirname(resolve(filePath));
  const repoRoot = resolve('.');
  while (dir.length >= repoRoot.length) {
    if (existsSync(resolve(dir, 'package.json')) && dir !== repoRoot) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function groupByPackage(files) {
  const groups = new Map();
  for (const f of files) {
    const pkg = packageRootFor(f);
    if (!pkg) continue;
    const arr = groups.get(pkg) ?? [];
    arr.push(relative(pkg, resolve(f)));
    groups.set(pkg, arr);
  }
  return groups;
}

export default {
  '*.{ts,tsx,mjs,cjs,js,jsx}': (files) => {
    const groups = groupByPackage(files);
    return [...groups.entries()].map(
      ([pkgDir, rel]) => `bash -c "cd ${pkgDir} && pnpm exec eslint --fix --no-warn-ignored ${rel.join(' ')}"`,
    );
  },
  'packages/backend-core/src/**/*.ts': () => [
    'pnpm -F @getmunin/backend-core openapi:generate',
    'git add packages/backend-core/openapi.json',
  ],
};
