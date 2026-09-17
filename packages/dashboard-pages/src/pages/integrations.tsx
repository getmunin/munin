'use client';

import { useTranslations } from 'next-intl';
import { Hero } from '@getmunin/ui';
import { OperatorBridgesSection } from '../components/integrations/operator-bridges-grid';
import { DataConnectionsSection } from '../components/integrations/connectors-grid';
import { PublishingAccountsSection } from '../components/integrations/publishing-accounts-grid';

export function IntegrationsPage() {
  const t = useTranslations('integrations');

  return (
    <div className="space-y-11">
      <Hero
        eyebrow={t('hero.eyebrow')}
        title={t.rich('hero.title', { em: (chunks) => <em>{chunks}</em> })}
        lede={t('hero.lede')}
      />
      <OperatorBridgesSection />
      <PublishingAccountsSection />
      <DataConnectionsSection />
    </div>
  );
}
