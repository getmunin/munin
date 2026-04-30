import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..', 'src');
const distRoot = join(here, '..', 'dist');

let copied = 0;
for (const file of walk(srcRoot)) {
  if (!file.endsWith('.md')) continue;
  const rel = relative(srcRoot, file);
  const target = join(distRoot, rel);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(file, target);
  copied += 1;
}
// eslint-disable-next-line no-console
console.log(`copied ${copied} runbook(s) into dist/`);

function walk(root) {
  const out = [];
  const queue = [root];
  while (queue.length > 0) {
    const dir = queue.shift();
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) queue.push(full);
      else if (st.isFile()) out.push(full);
    }
  }
  return out;
}
