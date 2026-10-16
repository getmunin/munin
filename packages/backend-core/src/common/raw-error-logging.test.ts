import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const PACKAGES_DIR = resolve(import.meta.dirname, '../../..');
const SCANNED = ['backend-core', 'core', 'mcp-toolkit', 'agent-host', 'agent-runtime', 'db'];
const ERROR_NAMES = '(?:err|error|e|reason|cause|reportErr)';

const CONSOLE_CALL = /console\.(?:log|info|warn|error|debug)\(([\s\S]*?)\);/g;
const BARE_ERROR_ARGUMENT = new RegExp(`(?:^|,)\\s*${ERROR_NAMES}\\s*(?:,|$)`);
const ERROR_IN_OBJECT = new RegExp(`\\{[^}]*\\b${ERROR_NAMES}\\b(?!\\s*[:.(])[^}]*\\}`);
const RAW_MESSAGE = new RegExp(`\\b${ERROR_NAMES}\\.message\\b`);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.name.endsWith('.ts') || /\.test\.ts$|\.d\.ts$/.test(entry.name)) return [];
    return [path];
  });
}

function rawErrorLogCalls(source: string): string[] {
  const hits: string[] = [];
  for (const match of source.matchAll(CONSOLE_CALL)) {
    const args = match[1]!;
    const withoutTemplates = args.replace(/`(?:\\.|\$\{[^}]*\}|[^`\\])*`/g, '``');
    if (
      BARE_ERROR_ARGUMENT.test(withoutTemplates) ||
      ERROR_IN_OBJECT.test(withoutTemplates) ||
      RAW_MESSAGE.test(args)
    ) {
      hits.push(match[0].replace(/\s+/g, ' ').slice(0, 160));
    }
  }
  return hits;
}

describe('console logging of errors', () => {
  it('flags the shapes that print a raw error, and leaves describeError calls alone', () => {
    expect(rawErrorLogCalls("console.error('[audit] failed:', err);")).toHaveLength(1);
    expect(rawErrorLogCalls("console.warn('[x] failed', { kid, err });")).toHaveLength(1);
    expect(rawErrorLogCalls('console.warn(`[x] failed: ${err.message}`);')).toHaveLength(1);
    expect(rawErrorLogCalls("console.error(\n  '[x] failed',\n  error,\n);")).toHaveLength(1);
    expect(rawErrorLogCalls('console.error(`[x] failed: ${describeError(err)}`);')).toEqual([]);
    expect(rawErrorLogCalls("console.warn('[x] blocked', { kid, alg });")).toEqual([]);
    expect(rawErrorLogCalls('console.log(`[skill-pass] ${redactQueryParams(m)}`);')).toEqual([]);
  });

  it('never prints a raw error object or message, so query parameters cannot reach stdout', () => {
    const offenders = SCANNED.flatMap((pkg) => {
      const root = join(PACKAGES_DIR, pkg, 'src');
      return sourceFiles(root).flatMap((file) =>
        rawErrorLogCalls(readFileSync(file, 'utf8')).map(
          (call) => `${relative(PACKAGES_DIR, file)}: ${call}`,
        ),
      );
    });
    expect(offenders).toEqual([]);
  });
});
