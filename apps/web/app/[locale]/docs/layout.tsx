import type { ReactNode } from 'react';
import './docs.css';
import { DocsShell } from './_components/docs-shell';
import { listEndpoints } from './_lib/openapi';
import { mcpTools } from './_lib/mcp';
import { skills } from './_lib/skills';
import { buildSearchIndex } from './_lib/search-index';
import { GUIDES } from './guides/_lib/guides';

export const metadata = {
  title: 'Munin · Developer portal',
  description:
    'REST API, MCP tools, and skills reference for the Munin platform.',
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  const counts = {
    rest: listEndpoints().length,
    mcp: mcpTools.length,
    skills: skills.length,
    guides: GUIDES.length,
  };
  const searchIndex = buildSearchIndex();
  return (
    <DocsShell counts={counts} searchIndex={searchIndex}>
      {children}
    </DocsShell>
  );
}
