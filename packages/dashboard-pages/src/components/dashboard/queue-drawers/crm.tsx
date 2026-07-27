'use client';

import { useTranslations } from 'next-intl';
import { useRelative } from '../../../lib/use-relative';
import { DrawerFooter, DrawerHeader, useCmdEnter } from './shared';
import type { CrmContactSummary, CrmMergeProposalDto } from './types';

export function CrmQueueDrawer({
  item,
  pending,
  onApprove,
  onDismiss,
  onClose,
}: {
  item: { id: string; title: string; createdAt: string; raw: CrmMergeProposalDto };
  pending: boolean;
  onApprove: () => void;
  onDismiss: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('dashboard.overview.drawer');
  const tQueue = useTranslations('dashboard.overview.queue');
  const age = useRelative();

  useCmdEnter(() => {
    if (!pending) onApprove();
  });

  const proposal = item.raw;
  const keeper =
    proposal.recommendedKeeperId === proposal.contactA.id ? proposal.contactA : proposal.contactB;
  const loser =
    proposal.recommendedKeeperId === proposal.contactA.id ? proposal.contactB : proposal.contactA;
  const fmt = (c: CrmContactSummary) => [c.name, c.email].filter(Boolean).join(' · ') || c.id;

  return (
    <>
      <DrawerHeader
        pillTone="crm"
        pillLabel={tQueue('kindCrm')}
        title={item.title}
        meta={t('metaCrm', { confidence: proposal.confidence, age: age(item.createdAt) })}
        onClose={onClose}
        closeLabel={t('close')}
      />

      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
        <section className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
            {t('proposal')}
          </p>
          <div className="border-[1px] border-ink bg-paper px-4 py-3 text-sm leading-relaxed dark:bg-card dark:border-rule-on-dark dark:text-foreground">
            <p>
              {t.rich('crmMergeBody', {
                loser: fmt(loser),
                keeper: fmt(keeper),
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
            <p className="mt-2 text-ink-mute">{t('crmMergeExplain')}</p>
          </div>
        </section>
      </div>

      <DrawerFooter
        primary={{ label: t('approve'), onClick: onApprove, disabled: pending }}
        secondary={[{ label: t('dismiss'), onClick: onDismiss, disabled: pending }]}
        shortcut={t('shortcutApprove')}
      />
    </>
  );
}
