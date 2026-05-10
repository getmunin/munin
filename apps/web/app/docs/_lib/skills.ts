import skillsFixture from '../../../../../packages/backend-core/docs-fixtures/skills.json';

export interface Skill {
  uri: string;
  module: string;
  slug: string;
  title: string;
  description: string;
  mimeType: string;
  content: string;
}

export const skills = skillsFixture as Skill[];

export function findSkill(module: string, slug: string): Skill | undefined {
  return skills.find((s) => s.module === module && s.slug === slug);
}

export function groupByModule(): Array<{ module: string; skills: Skill[] }> {
  const map = new Map<string, Skill[]>();
  for (const s of skills) {
    const list = map.get(s.module) ?? [];
    list.push(s);
    map.set(s.module, list);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([module, skills]) => ({ module, skills }));
}

export function wordCount(content: string): number {
  return content.split(/\s+/).filter(Boolean).length;
}
