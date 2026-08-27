'use client';

import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActiveRole } from '../auth/use-active-role';
import { Link } from '../i18n-navigation';
import { OSS_SETTINGS_GROUPS, type SettingsSubNavGroup } from '../nav/settings-groups';

export interface SettingsIndexPageProps {
  groups?: SettingsSubNavGroup[];
}

export function SettingsIndexPage({ groups = OSS_SETTINGS_GROUPS }: SettingsIndexPageProps) {
  const tNav = useTranslations('nav');
  const tGroups = useTranslations('dashboard.settings.groups');
  const tRoles = useTranslations('dashboard.settings.roles');
  const { role } = useActiveRole();

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="m-0 font-serif text-[36px] font-normal leading-none tracking-tight text-ink dark:text-foreground">
          {tNav('settings')}
        </h1>
        {role ? (
          <p className="mt-2 font-mono text-[9px] uppercase tracking-meta text-ink-mute dark:text-foreground/55">
            {tRoles(role)}
          </p>
        ) : null}
      </div>

      {groups.map((group) => (
        <div key={group.groupKey}>
          <p className="mb-2 font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute dark:text-foreground/55">
            {tGroups(group.groupKey)}
          </p>
          <div className="flex flex-col">
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group/srow flex min-h-12 items-center gap-3 border-b-[1px] border-rule-soft text-[15.5px] text-ink transition-colors duration-fast ease-munin hover:text-cobalt dark:border-rule-on-dark dark:text-foreground dark:hover:text-cobalt-soft"
              >
                <span className="truncate">{tNav(item.labelKey)}</span>
                <ArrowRight
                  aria-hidden
                  className="ml-auto size-4 shrink-0 text-ink-mute transition-colors duration-fast group-hover/srow:text-cobalt dark:group-hover/srow:text-cobalt-soft"
                />
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
