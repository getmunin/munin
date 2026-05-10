'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export interface SearchHit {
  kind: 'rest' | 'mcp' | 'skill';
  href: string;
  primary: string;
  badge: string;
  snippet: string;
  method?: string;
}

export interface SearchIndex {
  items: SearchHit[];
}

export function DocsSearch({ index }: { index: SearchIndex }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        ref.current?.querySelector('input')?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const Q = q.toLowerCase().trim();
  const hits = useMemo(() => {
    if (!Q) return null;
    const matches = index.items.filter((h) => {
      return (
        h.primary.toLowerCase().includes(Q) ||
        h.snippet.toLowerCase().includes(Q) ||
        h.badge.toLowerCase().includes(Q)
      );
    });
    return groupBy(matches);
  }, [Q, index.items]);

  const goAndClose = (href: string) => {
    router.push(href);
    setOpen(false);
    setQ('');
  };

  return (
    <div className="search-wrap" ref={ref}>
      <span className="icon">⌕</span>
      <input
        className="docs-search"
        placeholder="Search endpoints, tools, skills…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {!q && <span className="kbd">⌘K</span>}
      {open && hits && (
        <div className="search-results">
          {hits.total === 0 && <div className="empty">No matches for &ldquo;{q}&rdquo;.</div>}
          {hits.rest.length > 0 && <div className="group-h">REST · {hits.rest.length}</div>}
          {hits.rest.slice(0, 6).map((h) => (
            <a key={h.href} onClick={() => goAndClose(h.href)}>
              <div className="sr-h">
                <span className="sr-badge">{h.badge}</span>
                {h.method && (
                  <span className={'leaf-method m-' + h.method} style={{ width: 'auto' }}>
                    {h.method}
                  </span>
                )}
              </div>
              <span className="sr-title">{h.primary}</span>
              <span className="sr-snip">{h.snippet}</span>
            </a>
          ))}
          {hits.mcp.length > 0 && <div className="group-h">MCP · {hits.mcp.length}</div>}
          {hits.mcp.slice(0, 6).map((h) => (
            <a key={h.href} onClick={() => goAndClose(h.href)}>
              <div className="sr-h">
                <span className="sr-badge">{h.badge}</span>
                <span className="sr-title">{h.primary}</span>
              </div>
              <span className="sr-snip">{h.snippet}</span>
            </a>
          ))}
          {hits.skill.length > 0 && <div className="group-h">Skills · {hits.skill.length}</div>}
          {hits.skill.slice(0, 6).map((h) => (
            <a key={h.href} onClick={() => goAndClose(h.href)}>
              <div className="sr-h">
                <span className="sr-badge">{h.badge}</span>
                <span className="sr-title">{h.primary}</span>
              </div>
              <span className="sr-snip">{h.snippet}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function groupBy(matches: SearchHit[]) {
  const rest = matches.filter((m) => m.kind === 'rest');
  const mcp = matches.filter((m) => m.kind === 'mcp');
  const skill = matches.filter((m) => m.kind === 'skill');
  return { rest, mcp, skill, total: rest.length + mcp.length + skill.length };
}
