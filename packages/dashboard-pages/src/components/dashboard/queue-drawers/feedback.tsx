'use client';

import { useTranslations } from 'next-intl';
import { useRelative } from '../../../lib/use-relative';
import { DrawerFooter, DrawerHeader, useCmdEnter } from './shared';
import type { FeedbackOutboxDto } from './types';

export function FeedbackQueueDrawer({
  item,
  pending,
  onApprove,
  onDismiss,
  onClose,
}: {
  item: { id: string; title: string; createdAt: string; raw: FeedbackOutboxDto };
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

  const f = item.raw;
  const attributionKey =
    f.includeOrgName && f.includeUserName
      ? 'feedbackAttributionBoth'
      : f.includeOrgName
        ? 'feedbackAttributionOrg'
        : f.includeUserName
          ? 'feedbackAttributionUser'
          : 'feedbackAttributionAnonymous';

  return (
    <>
      <DrawerHeader
        pillTone="feedback"
        pillLabel={tQueue('kindFeedback')}
        title={item.title}
        meta={t('metaFeedback', {
          scope: f.appScope ? f.appScope.toUpperCase() : tQueue('feedbackScopeFallback'),
          age: age(item.createdAt),
        })}
        onClose={onClose}
        closeLabel={t('close')}
      />

      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
        <section className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
            {t('proposal')}
          </p>
          <div className="border-[1px] border-ink bg-paper px-4 py-3 text-sm leading-relaxed dark:bg-card dark:border-rule-on-dark dark:text-foreground">
            <p className="whitespace-pre-wrap">{f.body}</p>
            <p className="mt-3 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
              {t(attributionKey, { orgName: '—', userName: '—' })}
            </p>
            <p className="mt-2 text-ink-mute text-xs">{t('feedbackApproveConfirm')}</p>
            {f.forwardError && (
              <p className="mt-2 text-xs text-destructive">{f.forwardError}</p>
            )}
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
