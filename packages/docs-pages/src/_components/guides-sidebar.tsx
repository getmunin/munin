'use client';

import { Link, usePathname } from '../i18n-navigation';
import { GUIDE_GROUPS, GUIDES, guidesByCategory } from '../guides/_lib/guides';

export function GuidesSidebar() {
  const pathname = usePathname() ?? '';
  const byCategory = guidesByCategory();
  return (
    <aside className="docs-side">
      <div className="group">
        <div className="group-h">
          All <span className="ct">· {GUIDES.length}</span>
        </div>
        <Link className={pathname === '/docs/guides' ? 'active' : ''} href="/docs/guides">
          <span style={{ fontSize: 13 }}>Overview</span>
        </Link>
      </div>
      {GUIDE_GROUPS.map((grp) => {
        const list = byCategory.get(grp.id) ?? [];
        if (list.length === 0) return null;
        return (
          <div className="group" key={grp.id}>
            <div className="group-h">
              {grp.label} <span className="ct">· {list.length}</span>
            </div>
            {list.map((g) => {
              const href = `/docs/guides/${g.slug}`;
              return (
                <Link key={g.slug} className={pathname === href ? 'active' : ''} href={href}>
                  <span style={{ fontSize: 13 }}>{g.title}</span>
                </Link>
              );
            })}
          </div>
        );
      })}
    </aside>
  );
}
