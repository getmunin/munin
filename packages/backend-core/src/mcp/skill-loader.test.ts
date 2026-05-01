import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSkills } from './skill-loader.js';

describe('loadSkills', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'munin-skills-'));
    mkdirSync(join(root, 'conv', 'skills'), { recursive: true });
    mkdirSync(join(root, 'crm', 'skills'), { recursive: true });
    mkdirSync(join(root, 'playbooks', 'skills'), { recursive: true });
    mkdirSync(join(root, 'kb'), { recursive: true });

    writeFileSync(
      join(root, 'conv', 'skills', 'email-setup.md'),
      `---\ntitle: Email channel setup\ndescription: Configure email.\naudiences: [admin]\n---\n\n# body of email-setup\n`,
    );
    writeFileSync(
      join(root, 'crm', 'skills', 'onboarding.md'),
      `---\ntitle: CRM onboarding\ndescription: Add a new contact.\naudiences: [admin, self_service]\n---\n\nbody of onboarding\n`,
    );
    writeFileSync(
      join(root, 'playbooks', 'skills', 'customer-acquisition.md'),
      `---\ntitle: Customer acquisition\ndescription: Cross-module workflow.\naudiences: [admin]\n---\n\nbody\n`,
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
    const found = loadSkills([{ root }]);
    const uris = found.map((s) => s.uri);
    expect(uris).not.toContain('skill://kb/no-frontmatter');
  });

  it('builds URIs from the parent directory + slug', () => {
    const found = loadSkills([{ root }]);
    const uris = found.map((s) => s.uri).sort();
    expect(uris).toEqual([
      'skill://conv/email-setup',
      'skill://crm/onboarding',
      'skill://kb/self-service-only',
      'skill://playbooks/customer-acquisition',
    ]);
  });

  it('parses frontmatter (title, description, audiences)', () => {
    const found = loadSkills([{ root }]);
    const email = found.find((s) => s.uri === 'skill://conv/email-setup')!;
    expect(email.name).toBe('Email channel setup');
    expect(email.description).toBe('Configure email.');
    expect(email.audiences).toEqual(['admin']);
    expect(email.mimeType).toBe('text/markdown');
    expect(email.content).toContain('# body of email-setup');
  });

  it('supports either `audience` (singular) or `audiences` (array)', () => {
    const found = loadSkills([{ root }]);
    const single = found.find((s) => s.uri === 'skill://kb/self-service-only')!;
    expect(single.audiences).toEqual(['self_service']);
    const multi = found.find((s) => s.uri === 'skill://crm/onboarding')!;
    expect(multi.audiences).toEqual(['admin', 'self_service']);
  });

  it('throws on duplicate URIs across roots', () => {
    expect(() => loadSkills([{ root }, { root }])).toThrow(/Duplicate skill URI/);
  });

  it('returns empty when root does not exist', () => {
    const found = loadSkills([{ root: '/tmp/does-not-exist-skill-fixture' }]);
    expect(found).toEqual([]);
  });
});
