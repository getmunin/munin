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
    writeFileSync(
      join(root, 'kb', 'no-title.md'),
      `---\ndescription: A skill without a title.\naudiences: [admin]\n---\n\nbody\n`,
    );
    writeFileSync(
      join(root, 'kb', 'empty-audiences.md'),
      `---\ntitle: Empty audiences\ndescription: No audiences declared.\naudiences: []\n---\n\nbody\n`,
    );
    writeFileSync(
      join(root, 'kb', 'unknown-audience.md'),
      `---\ntitle: Unknown audience\ndescription: Audience value is not in the enum.\naudiences: [robots]\n---\n\nbody\n`,
    );
    writeFileSync(
      join(root, 'kb', 'internal-only.md'),
      `---\ntitle: Internal only\ndescription: Not exposed publicly.\naudiences: [admin]\npublic: false\n---\n\nbody\n`,
    );
    writeFileSync(
      join(root, 'kb', 'malformed-frontmatter.md'),
      `---\ntitle Without colon line\ndescription: still parsed\naudiences: [admin]\n---\n\nbody\n`,
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
      'skill://kb/empty-audiences',
      'skill://kb/internal-only',
      'skill://kb/malformed-frontmatter',
      'skill://kb/no-title',
      'skill://kb/self-service-only',
      'skill://kb/unknown-audience',
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

  it('falls back to slug when frontmatter omits title', () => {
    const found = loadSkills([{ root }]);
    const noTitle = found.find((s) => s.uri === 'skill://kb/no-title')!;
    expect(noTitle).toBeDefined();
    expect(noTitle.name).toBe('no-title');
    expect(noTitle.description).toBe('A skill without a title.');
  });

  it('defaults audiences to [admin] when the array is empty', () => {
    const found = loadSkills([{ root }]);
    const empty = found.find((s) => s.uri === 'skill://kb/empty-audiences')!;
    expect(empty).toBeDefined();
    expect(empty.audiences).toEqual(['admin']);
  });

  it('defaults audiences to [admin] when only unknown values are listed', () => {
    const found = loadSkills([{ root }]);
    const unknown = found.find((s) => s.uri === 'skill://kb/unknown-audience')!;
    expect(unknown).toBeDefined();
    expect(unknown.audiences).toEqual(['admin']);
  });

  it('honours `public: false` and excludes from listPublic semantics', () => {
    const found = loadSkills([{ root }]);
    const internal = found.find((s) => s.uri === 'skill://kb/internal-only')!;
    expect(internal).toBeDefined();
    expect(internal.public).toBe(false);
    const defaultPublic = found.find((s) => s.uri === 'skill://kb/self-service-only')!;
    expect(defaultPublic.public).toBe(true);
  });

  it('skips malformed frontmatter lines without crashing the file', () => {
    const found = loadSkills([{ root }]);
    const malformed = found.find((s) => s.uri === 'skill://kb/malformed-frontmatter')!;
    expect(malformed).toBeDefined();
    expect(malformed.name).toBe('malformed-frontmatter');
    expect(malformed.description).toBe('still parsed');
    expect(malformed.audiences).toEqual(['admin']);
  });
});
