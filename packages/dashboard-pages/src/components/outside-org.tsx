'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { orgDashboardPath } from '@getmunin/types';
import { Button } from '@getmunin/ui';
import { Link, useRouter, useScopedPathname } from '../i18n-navigation';
import { authClient } from '../auth-client';
import { useDefaultMembership } from '../auth/use-active-role';
import { signInHrefFor } from '../auth/post-signin-redirect';
import { StandaloneNotice, noticeEmphasis } from './standalone-notice';

export function OutsideOrg({ orgId }: { orgId: string }) {
  const t = useTranslations('dashboard.outsideOrg');
  const { membership } = useDefaultMembership();
  const router = useRouter();
  const scopedPathname = useScopedPathname();
  const [switching, setSwitching] = useState(false);

  function switchAccount() {
    setSwitching(true);
    void (async () => {
      await authClient.signOut();
      const search = typeof window !== 'undefined' ? window.location.search : '';
      router.push(signInHrefFor(`${scopedPathname}${search}`));
    })();
  }

  return (
    <StandaloneNotice
      eyebrow={t('eyebrow')}
      title={t.rich('title', { em: noticeEmphasis })}
      lede={t('lede')}
      footnote={orgId}
      action={
        <div className="flex flex-wrap gap-3">
          <Button size="lg" onClick={switchAccount} disabled={switching}>
            {switching ? t('switching') : t('switchAccount')}
          </Button>
          {membership ? (
            <Button
              size="lg"
              variant="outline"
              render={<Link href={orgDashboardPath('/dashboard', membership.orgId)} />}
            >
              {t('switchBack', { org: membership.name })}
            </Button>
          ) : null}
        </div>
      }
    />
  );
}
