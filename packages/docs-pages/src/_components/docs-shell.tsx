'use client';

import Image from 'next/image';
import { Link, usePathname } from '../i18n-navigation';
import { useEffect, useRef, type ReactNode } from 'react';
import { DocsSearch, type SearchIndex } from './search';

export function DocsShell({
  children,
  counts,
  searchIndex,
}: {
  children: ReactNode;
  counts: { rest: number; mcp: number; skills: number; guides: number };
  searchIndex: SearchIndex;
}) {
  const pathname = usePathname();
  const section = sectionFromPath(pathname);
  const stuckRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = stuckRef.current;
    if (!el) return;
    const update = () => {
      document.documentElement.style.setProperty(
        '--docs-stuck-h',
        `${el.getBoundingClientRect().height}px`,
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  return (
    <div className="docs">
      <div className="docs-stuck" ref={stuckRef}>
      <header className="docs-topbar">
        <Link href="/" className="mark" aria-label="Munin">
          <Image src="/munin-logo.png" alt="Munin" width={28} height={28} priority />
        </Link>
        <div className="sep" aria-hidden />
        <div className="org-name">Munin developer portal</div>
        <div className="spacer" />
        <Link className="docs-btn primary" href="/dashboard/settings/api-keys">
          Get a key →
        </Link>
      </header>

      <nav className="docs-switcher">
        <Link className={section === 'started' ? 'active' : ''} href="/docs">
          Get <em>started</em>
        </Link>
        <Link className={section === 'guides' ? 'active' : ''} href="/docs/guides">
          <em>Guides</em>
          <span className="ct">{counts.guides}</span>
        </Link>
        <Link className={section === 'rest' ? 'active' : ''} href="/docs/rest">
          REST <em>API</em>
          <span className="ct">{counts.rest}</span>
        </Link>
        <Link className={section === 'mcp' ? 'active' : ''} href="/docs/mcp">
          <em>MCP</em> Tools
          <span className="ct">{counts.mcp}</span>
        </Link>
        <Link className={section === 'skills' ? 'active' : ''} href="/docs/skills">
          <em>Skills</em> Library
          <span className="ct">{counts.skills}</span>
        </Link>
        <div className="spacer" />
        <DocsSearch index={searchIndex} />
      </nav>
      </div>

      <div className="docs-body">{children}</div>
    </div>
  );
}

function sectionFromPath(
  path: string | null,
): 'started' | 'rest' | 'mcp' | 'skills' | 'guides' {
  if (!path) return 'started';
  if (path.startsWith('/docs/rest')) return 'rest';
  if (path.startsWith('/docs/mcp')) return 'mcp';
  if (path.startsWith('/docs/skills')) return 'skills';
  if (path.startsWith('/docs/guides')) return 'guides';
  return 'started';
}
