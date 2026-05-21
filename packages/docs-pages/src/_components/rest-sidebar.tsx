'use client';

import { useEffect, useState } from 'react';
import type { TagGroup } from '../_lib/openapi';

export function RestSidebar({ groups }: { groups: TagGroup[] }) {
  const [activeId, setActiveId] = useState<string>('');

  useEffect(() => {
    const sync = () => setActiveId(window.location.hash.replace(/^#/, ''));
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  return (
    <aside className="docs-side">
      {groups.map((g) => (
        <div className="group" key={g.tag}>
          <div className="group-h">
            {g.tag} <span className="ct">· {g.endpoints.length}</span>
          </div>
          {g.endpoints.map((ep) => (
            <a
              key={ep.id}
              className={activeId === ep.id ? 'active' : ''}
              href={`#${ep.id}`}
            >
              <span className={'leaf-method m-' + ep.method.toUpperCase()}>
                {ep.method.toUpperCase()}
              </span>
              <span className="leaf-path">{ep.path.replace('/api/v1', '')}</span>
            </a>
          ))}
        </div>
      ))}
    </aside>
  );
}
