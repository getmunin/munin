'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@getmunin/ui';
import type { InboxController } from './inbox-types';

export function ScheduledCancelDialog({ controller }: { controller: InboxController }) {
  const t = useTranslations('dashboard.overview.scheduled');
  const { cancelTarget, setCancelTarget, pending, cancelScheduledSend, cancelScheduledPublish } =
    controller;
  const [reason, setReason] = useState('');
  const needsReason = cancelTarget?.kind === 'outreach';
  const isCms = cancelTarget?.kind === 'cms';

  useEffect(() => {
    if (cancelTarget) setReason('');
  }, [cancelTarget]);

  const submit = async () => {
    if (!cancelTarget) return;
    if (needsReason && !reason.trim()) return;
    try {
      if (cancelTarget.kind === 'outreach') {
        await cancelScheduledSend(cancelTarget.id, reason.trim());
      } else {
        await cancelScheduledPublish(cancelTarget.id);
      }
    } catch (err) {
      console.warn('[scheduled] cancel failed', err);
    }
  };

  return (
    <Dialog
      open={cancelTarget !== null}
      onOpenChange={(o) => {
        if (!o) setCancelTarget(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isCms ? t('cancelCmsTitle') : t('cancelTitle')}</DialogTitle>
          <DialogDescription>
            {isCms ? t('cancelCmsDescription') : t('cancelDescription')}
          </DialogDescription>
        </DialogHeader>
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {needsReason && (
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
                {t('cancelReasonLabel')}
              </span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                className="rounded-input border-[1px] border-rule-soft bg-paper px-3 py-2 font-sans text-sm text-ink outline-none focus-visible:border-cobalt focus-visible:ring-1 focus-visible:ring-cobalt dark:border-rule-on-dark dark:bg-card dark:text-foreground"
                autoFocus
              />
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCancelTarget(null)}>
              {t('cancelDismiss')}
            </Button>
            <Button
              type="submit"
              variant="accent"
              disabled={pending || (needsReason && !reason.trim())}
            >
              {isCms ? t('cancelCmsConfirm') : t('cancelConfirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
