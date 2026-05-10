import { listEndpoints, tagSlug } from './openapi';
import { mcpTools } from './mcp';
import { skills } from './skills';
import type { SearchIndex } from '../_components/search';

export function buildSearchIndex(): SearchIndex {
  const items: SearchIndex['items'] = [];

  for (const ep of listEndpoints()) {
    items.push({
      kind: 'rest',
      href: `/docs/rest#${ep.id}`,
      primary: ep.path,
      badge: `REST · ${ep.tag}`,
      snippet: ep.op.summary ?? ep.op.description ?? '',
      method: ep.method.toUpperCase(),
    });
  }
  void tagSlug;

  for (const t of mcpTools) {
    const audience = t.audiences.includes('admin') ? 'admin' : 'self-service';
    items.push({
      kind: 'mcp',
      href: `/docs/mcp#${t.name}`,
      primary: t.name,
      badge: `MCP · ${audience}`,
      snippet: t.description,
    });
  }

  for (const s of skills) {
    items.push({
      kind: 'skill',
      href: `/docs/skills/${s.module}/${s.slug}`,
      primary: `skill://${s.module}/${s.slug}`,
      badge: `Skill · ${s.module}`,
      snippet: s.description,
    });
  }

  return { items };
}
