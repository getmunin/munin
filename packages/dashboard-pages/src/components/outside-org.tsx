'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@getmunin/ui';
import { Link } from '../i18n-navigation';
import { useDefaultMembership } from '../auth/use-active-role';
import { orgDashboardPath } from '@getmunin/types';

export function OutsideOrg({ orgId }: { orgId: string }) {
  const t = useTranslations('dashboard.outsideOrg');
  const { membership } = useDefaultMembership();

  return (
    <section className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-5 px-6 text-ink dark:text-foreground">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        {t('eyebrow')}
      </p>
      <h1 className="text-2xl font-medium">{t('title')}</h1>
      <p className="text-muted-foreground">{t('lede')}</p>
      <p className="font-mono text-[11px] text-muted-foreground">{orgId}</p>
      {membership ? (
        <Button
          className="self-start"
          render={<Link href={orgDashboardPath('/dashboard', membership.orgId)} />}
        >
          {t('switchBack', { org: membership.name })}
        </Button>
      ) : null}
    </section>
  );
}
