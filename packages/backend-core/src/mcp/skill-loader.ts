import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename, relative, sep } from 'node:path';
import type { RegisteredSkill } from '@getmunin/mcp-toolkit';
import type { Audience } from '@getmunin/core';

export interface SkillSource {
  /** Absolute path to a directory tree to scan for `*.md` files. */
  root: string;
  /**
   * Top-level URI namespace for skills under this root. Files inside
   * subdirectories use the subdirectory name as the module segment.
   * If omitted, the namespace is derived from the immediate parent
   * directory name of each file (one level up from the markdown file).
   */
  namespace?: string;
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

export function loadSkills(sources: SkillSource[]): RegisteredSkill[] {
  const out: RegisteredSkill[] = [];
  const seen = new Set<string>();
  for (const src of sources) {
    if (!exists(src.root)) continue;
    for (const file of walkMarkdown(src.root)) {
      const skill = parseSkill(file, src);
      if (!skill) continue;
      if (seen.has(skill.uri)) {
        throw new Error(`Duplicate skill URI: ${skill.uri} (from ${file})`);
      }
      seen.add(skill.uri);
      out.push(skill);
    }
  }
  return out;
}

function exists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

function walkMarkdown(root: string): string[] {
  const found: string[] = [];
  const queue: string[] = [root];
  while (queue.length > 0) {
    const dir = queue.shift()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        queue.push(full);
      } else if (st.isFile() && name.endsWith('.md')) {
        found.push(full);
      }
    }
  }
  return found.sort();
}

function parseSkill(file: string, src: SkillSource): RegisteredSkill | null {
  const raw = readFileSync(file, 'utf8');
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return null;
  const fm = parseFrontmatter(match[1]!);
  const body = raw.slice(match[0].length);
  const slug = basename(file, '.md');
  const moduleSegment = deriveModule(file, src);
  const scheme = fm.kind === 'task' ? 'task' : 'skill';
  const uri = `${scheme}://${moduleSegment}/${slug}`;
  const audiences = normalizeAudiences(fm.audiences ?? fm.audience);
  // Skills default to public *only* when they target self_service — i.e.
  // end-user-facing how-tos. Admin-audience skills (operator playbooks,
  // setup procedures, escalation guides) default to private: their
  // content is operationally sensitive and shouldn't be served via the
  // anonymous /v1/public/skills endpoint or the published docs site
  // unless an operator explicitly opts each one in with `public: true`.
  // Task URIs are always private; only authenticated curator runs see them.
  const publicDefault = scheme === 'skill' && audiences.includes('self_service');
  return {
    uri,
    name: typeof fm.title === 'string' && fm.title ? fm.title : slug,
    description: typeof fm.description === 'string' ? fm.description : '',
    audiences,
    mimeType: typeof fm.mimeType === 'string' ? fm.mimeType : 'text/markdown',
    content: body.trimStart(),
    public:
      fm.public === undefined
        ? publicDefault
        : fm.public !== false && fm.public !== 'false',
  };
}

function deriveModule(file: string, src: SkillSource): string {
  if (src.namespace) return src.namespace;
  const rel = relative(src.root, file);
  const parts = rel.split(sep).slice(0, -1).filter((p) => p !== 'skills');
  return parts[parts.length - 1] ?? 'core';
}

function parseFrontmatter(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon < 0) continue;
    const key = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    out[key] = parseValue(value);
  }
  return out;
}

function parseValue(raw: string): unknown {
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return raw
      .slice(1, -1)
      .split(',')
      .map((s) => unquote(s.trim()))
      .filter((s) => s.length > 0);
  }
  return unquote(raw);
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function normalizeAudiences(value: unknown): readonly Audience[] {
  const valid: Audience[] = ['admin', 'self_service'];
  if (Array.isArray(value)) {
    const filtered = value.filter((v): v is Audience => typeof v === 'string' && (valid as string[]).includes(v));
    return filtered.length > 0 ? filtered : ['admin'];
  }
  if (typeof value === 'string' && (valid as string[]).includes(value)) {
    return [value as Audience];
  }
  return ['admin'];
}
