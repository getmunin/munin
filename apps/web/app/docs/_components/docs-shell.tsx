'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { DocsSearch, type SearchIndex } from './search';

export function DocsShell({
  children,
  counts,
  searchIndex,
}: {
  children: ReactNode;
  counts: { rest: number; mcp: number; skills: number };
  searchIndex: SearchIndex;
}) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    setDrawer(false);
  }, [pathname]);

  const section = sectionFromPath(pathname);

  return (
    <div className="docs" data-drawer={drawer ? 'open' : 'closed'}>
      <header className="docs-topbar">
        <button className="menu-btn" onClick={() => setDrawer((d) => !d)} aria-label="Menu">
          ☰
        </button>
        <Link href="/" className="mark" aria-label="Munin">
          Munin
        </Link>
        <div className="sep" aria-hidden />
        <div className="org-name">
          Munin <em>developer</em> portal
        </div>
        <div className="spacer" />
        <Link className="docs-btn primary" href="/setup">
          Get a key →
        </Link>
      </header>

      <nav className="docs-switcher">
        <Link className={section === 'started' ? 'active' : ''} href="/docs">
          Get <em>started</em>
        </Link>
        <Link className={section === 'rest' ? 'active' : ''} href="/docs/rest">
          REST <em>API</em>
          <span className="ct">{counts.rest}</span>
        </Link>
        <Link className={section === 'mcp' ? 'active' : ''} href="/docs/mcp">
          MCP <em>Tools</em>
          <span className="ct">{counts.mcp}</span>
        </Link>
        <Link className={section === 'skills' ? 'active' : ''} href="/docs/skills">
          Skills<span className="ct">{counts.skills}</span>
        </Link>
        <div className="spacer" />
        <DocsSearch index={searchIndex} />
      </nav>

      <div className="docs-body">{children}</div>
    </div>
  );
}

function sectionFromPath(path: string | null): 'started' | 'rest' | 'mcp' | 'skills' {
  if (!path) return 'started';
  if (path.startsWith('/docs/rest')) return 'rest';
  if (path.startsWith('/docs/mcp')) return 'mcp';
  if (path.startsWith('/docs/skills')) return 'skills';
  return 'started';
}
