import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const RULE = 'no-restricted-syntax';

function linter(cwd: string): ESLint {
  return new ESLint({
    cwd,
    ruleFilter: ({ ruleId }) => ruleId === RULE,
    overrideConfig: [{ languageOptions: { parserOptions: { projectService: false } } }],
  });
}

async function flagged(source: string, filePath = 'src/probe.ts'): Promise<number> {
  const [result] = await linter(resolve(import.meta.dirname, '..')).lintText(source, { filePath });
  expect(result!.messages.filter((m) => m.ruleId !== RULE)).toEqual([]);
  return result!.messages.length;
}

function lintedPackages(): string[] {
  return ['apps', 'packages'].flatMap((group) =>
    readdirSync(join(REPO_ROOT, group))
      .filter((name) => name !== 'eslint-config')
      .map((name) => join(REPO_ROOT, group, name))
      .filter((dir) => existsSync(join(dir, 'eslint.config.mjs'))),
  );
}

describe('dynamic imports of a relative .ts path', () => {
  it('are flagged in every shape tsc can leave unrewritten inside a decorated class', async () => {
    expect(await flagged("export const load = () => import('./x.ts');")).toBe(1);
    expect(await flagged("export const load = () => import(\n  '../a/x.ts',\n);")).toBe(1);
    expect(await flagged("export const load = () => import('./x.ts', { with: { type: 'json' } });")).toBe(1);
    expect(await flagged("export const load = () => import('./panel.tsx');")).toBe(1);
    expect(await flagged("export const load = () => import('./x.mts');")).toBe(1);
    expect(await flagged('export const load = () => import(`./x.ts`);')).toBe(1);
    expect(await flagged('export const load = (name: string) => import(`./adapters/${name}.ts`);')).toBe(1);
    expect(await flagged("export const load = (name: string) => import('./adapters/' + name + '.ts');")).toBe(1);
  });

  it('are left alone where nothing reaches the built output, or the specifier is not a .ts path', async () => {
    expect(await flagged("export type Render = typeof import('./x.ts');")).toBe(0);
    expect(await flagged("export function f(x: import('./x.ts').Foo): void {\n  void x;\n}")).toBe(0);
    expect(await flagged("// await import('./x.ts')\nexport const x = 1;")).toBe(0);
    expect(await flagged("export const load = () => import('./en.json');")).toBe(0);
    expect(await flagged("export const load = () => import('node:fs');")).toBe(0);
    expect(await flagged("export const load = () => import('./x.ts');", 'src/probe.test.ts')).toBe(0);
  });

  it('are refused by the lint config of every package, not only this one', async () => {
    const packages = lintedPackages();
    expect(packages.length).toBeGreaterThan(10);
    const unguarded: string[] = [];
    for (const dir of packages) {
      const config = (await linter(dir).calculateConfigForFile(join(dir, 'src/probe.ts'))) as {
        rules?: Record<string, unknown[]>;
      };
      const severity = config.rules?.[RULE]?.[0];
      if (severity !== 2 && severity !== 'error') unguarded.push(dir.slice(REPO_ROOT.length + 1));
    }
    expect(unguarded).toEqual([]);
  });
});
