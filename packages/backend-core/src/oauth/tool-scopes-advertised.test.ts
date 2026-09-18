import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_SCOPES } from './oauth.constants.ts';

const SRC_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DECORATOR = '@McpTool(';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!entry.endsWith('.ts')) continue;
    if (entry.endsWith('.test.ts') || entry.endsWith('.integration.test.ts')) continue;
    out.push(full);
  }
  return out;
}

function declaredScopes(source: string): string[] {
  const found: string[] = [];
  let at = source.indexOf(DECORATOR);
  while (at !== -1) {
    const next = source.indexOf(DECORATOR, at + DECORATOR.length);
    const block = source.slice(at, next === -1 ? source.length : next);
    const scopes = block.match(/scopes:\s*\[([^\]]*)\]/);
    if (scopes?.[1]) {
      for (const quoted of scopes[1].matchAll(/'([^']+)'/g)) found.push(quoted[1]!);
    }
    at = next;
  }
  return found;
}

describe('every tool scope is one an OAuth client can actually be granted', () => {
  const advertised = new Set<string>(SUPPORTED_SCOPES);

  it('declares no @McpTool scope missing from SUPPORTED_SCOPES — an unadvertised scope cannot be requested, consented to, or carried in a token, so the tool is invisible to every OAuth agent while still working under a wildcard API key', () => {
    const strays: string[] = [];
    for (const file of sourceFiles(SRC_ROOT)) {
      const source = readFileSync(file, 'utf8');
      if (!source.includes(DECORATOR)) continue;
      for (const scope of declaredScopes(source)) {
        if (!advertised.has(scope)) strays.push(`${relative(SRC_ROOT, file)}: ${scope}`);
      }
    }
    expect(strays).toEqual([]);
  });

  it('finds the tool scopes it is meant to be checking, so a broken scan cannot pass as a clean one', () => {
    const scanned = new Set<string>();
    for (const file of sourceFiles(SRC_ROOT)) {
      const source = readFileSync(file, 'utf8');
      if (!source.includes(DECORATOR)) continue;
      for (const scope of declaredScopes(source)) scanned.add(scope);
    }
    expect(scanned.has('kb:read')).toBe(true);
    expect(scanned.has('social:write')).toBe(true);
    expect(scanned.size).toBeGreaterThan(20);
  });
});
