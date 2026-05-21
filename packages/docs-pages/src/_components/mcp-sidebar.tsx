'use client';

import { useEffect, useState } from 'react';
import type { McpTool } from '../_lib/mcp';

export function McpSidebar({ admin, selfService }: { admin: McpTool[]; selfService: McpTool[] }) {
  const [activeId, setActiveId] = useState<string>('');

  useEffect(() => {
    const sync = () => setActiveId(window.location.hash.replace(/^#/, ''));
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  return (
    <aside className="docs-side">
      <div className="group">
        <div className="group-h">
          Admin tools <span className="ct">· {admin.length}</span>
        </div>
        {admin.map((t) => (
          <a key={t.name} className={activeId === t.name ? 'active' : ''} href={`#${t.name}`}>
            <span className="leaf-mono">{t.name}</span>
          </a>
        ))}
      </div>
      <div className="group">
        <div className="group-h">
          Self-service <span className="ct">· {selfService.length}</span>
        </div>
        {selfService.map((t) => (
          <a key={'ss_' + t.name} className={activeId === t.name ? 'active' : ''} href={`#${t.name}`}>
            <span className="leaf-mono">{t.name}</span>
          </a>
        ))}
      </div>
    </aside>
  );
}
