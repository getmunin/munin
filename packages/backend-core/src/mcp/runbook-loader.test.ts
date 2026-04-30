import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadRunbooks } from './runbook-loader.js';

describe('loadRunbooks', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'munin-runbooks-'));
    mkdirSync(join(root, 'conv', 'runbooks'), { recursive: true });
    mkdirSync(join(root, 'crm', 'runbooks'), { recursive: true });
    mkdirSync(join(root, 'kb'), { recursive: true });

    writeFileSync(
      join(root, 'conv', 'runbooks', 'email-setup.md'),
      `---\ntitle: Email channel setup\ndescription: Configure email.\naudiences: [admin]\n---\n\n# body of email-setup\n`,
    );
    writeFileSync(
      join(root, 'crm', 'runbooks', 'onboarding.md'),
      `---\ntitle: CRM onboarding\ndescription: Add a new contact.\naudiences: [admin, self_service]\n---\n\nbody of onboarding\n`,
    );
    writeFileSync(
      join(root, 'kb', 'no-frontmatter.md'),
      `# Just a heading, no frontmatter\n`,
    );
    writeFileSync(
      join(root, 'kb', 'self-service-only.md'),
      `---\ntitle: KB self-service\ndescription: For end users.\naudience: self_service\n---\n\nbody\n`,
    );
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('skips files without frontmatter', () => {
    const found = loadRunbooks([{ root }]);
    const uris = found.map((r) => r.uri);
    expect(uris).not.toContain('runbook://kb/no-frontmatter');
  });

  it('builds URIs from the parent directory + slug', () => {
    const found = loadRunbooks([{ root }]);
    const uris = found.map((r) => r.uri).sort();
    expect(uris).toEqual([
      'runbook://conv/email-setup',
      'runbook://crm/onboarding',
      'runbook://kb/self-service-only',
    ]);
  });

  it('parses frontmatter (title, description, audiences)', () => {
    const found = loadRunbooks([{ root }]);
    const email = found.find((r) => r.uri === 'runbook://conv/email-setup')!;
    expect(email.name).toBe('Email channel setup');
    expect(email.description).toBe('Configure email.');
    expect(email.audiences).toEqual(['admin']);
    expect(email.mimeType).toBe('text/markdown');
    expect(email.content).toContain('# body of email-setup');
  });

  it('supports either `audience` (singular) or `audiences` (array)', () => {
    const found = loadRunbooks([{ root }]);
    const single = found.find((r) => r.uri === 'runbook://kb/self-service-only')!;
    expect(single.audiences).toEqual(['self_service']);
    const multi = found.find((r) => r.uri === 'runbook://crm/onboarding')!;
    expect(multi.audiences).toEqual(['admin', 'self_service']);
  });

  it('throws on duplicate URIs across roots', () => {
    expect(() => loadRunbooks([{ root }, { root }])).toThrow(/Duplicate runbook URI/);
  });

  it('returns empty when root does not exist', () => {
    const found = loadRunbooks([{ root: '/tmp/does-not-exist-runbook-fixture' }]);
    expect(found).toEqual([]);
  });
});
