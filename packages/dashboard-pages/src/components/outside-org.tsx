'use client';

import { useTranslations } from 'next-intl';
import { orgDashboardPath } from '@getmunin/types';
import { Button } from '@getmunin/ui';
import { Link } from '../i18n-navigation';
import { useDefaultMembership } from '../auth/use-active-role';
import { StandaloneNotice, noticeEmphasis } from './standalone-notice';

export function OutsideOrg({ orgId }: { orgId: string }) {
  const t = useTranslations('dashboard.outsideOrg');
  const { membership } = useDefaultMembership();

  return (
    <StandaloneNotice
      eyebrow={t('eyebrow')}
      title={t.rich('title', { em: noticeEmphasis })}
      lede={t('lede')}
      footnote={orgId}
      action={
        membership ? (
          <Button
            size="lg"
            render={<Link href={orgDashboardPath('/dashboard', membership.orgId)} />}
          >
            {t('switchBack', { org: membership.name })}
          </Button>
        ) : null
      }
    />
  );
}
