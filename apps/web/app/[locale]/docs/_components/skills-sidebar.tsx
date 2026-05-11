'use client';

import { Link, usePathname } from '@/i18n/navigation';
import type { Skill } from '../_lib/skills';

export function SkillsSidebar({ groups }: { groups: Array<{ module: string; skills: Skill[] }> }) {
  const pathname = usePathname() ?? '';
  return (
    <aside className="docs-side">
      {groups.map((g) => (
        <div className="group" key={g.module}>
          <div className="group-h">
            {g.module} <span className="ct">· {g.skills.length}</span>
          </div>
          {g.skills.map((s) => {
            const href = `/docs/skills/${s.module}/${s.slug}`;
            return (
              <Link key={s.uri} className={pathname === href ? 'active' : ''} href={href}>
                <span style={{ fontSize: 13 }}>{s.title}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
