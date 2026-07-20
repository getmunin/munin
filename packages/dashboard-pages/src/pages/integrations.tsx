'use client';

import { useTranslations } from 'next-intl';
import { Hero } from '@getmunin/ui';

/**
 * Integrations hub: third-party systems connected to Munin, grouped by who
 * they serve. Operator bridges (Slack, later Teams) serve the team; a
 * "Connectors" section for customer-facing systems of record (Shopify,
 * Magento, …) slots in here once those grow a management surface.
 */
export function IntegrationsPage() {
  const t = useTranslations('integrations');

  return (
    <div className="max-w-3xl space-y-10">
      <Hero
        eyebrow={t('hero.eyebrow')}
        title={t.rich('hero.title', { em: (chunks) => <em>{chunks}</em> })}
        lede={t('hero.lede')}
      />

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">{t('operatorBridges.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('operatorBridges.blurb')}</p>
        </div>
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">{t('operatorBridges.empty')}</p>
        </div>
      </section>
    </div>
  );
}
