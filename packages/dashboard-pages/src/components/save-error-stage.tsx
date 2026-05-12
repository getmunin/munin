'use client';

import { RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Button,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@getmunin/ui';
import { dialogButtonClass, dialogFooterClass } from '../lib/dialog-style';

export interface SaveErrorDetail {
  endpoint: string;
  method: string;
  status: string;
  requestId: string | null;
}

export interface SaveErrorStageProps {
  detail: SaveErrorDetail;
  onBack: () => void;
  onRetry: () => void;
  retrying?: boolean;
}

/**
 * Drop-in "save failed" stage for dialog forms. Replaces the form view while
 * preserving the parent component's input state — clicking Back returns to the
 * form with values intact, Retry re-attempts the same submit.
 */
export function SaveErrorStage({
  detail,
  onBack,
  onRetry,
  retrying = false,
}: SaveErrorStageProps) {
  const t = useTranslations('dashboard.saveFailed');
  const tCommon = useTranslations('common');

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('sub')}</DialogDescription>
      </DialogHeader>

      <div className="border-[0.5px] border-cobalt/40 dark:border-cobalt-soft/40 bg-paper-deep dark:bg-secondary p-5 space-y-4">
        <p className="text-sm leading-relaxed text-ink dark:text-foreground">{t('body')}</p>
        <hr className="border-t-[0.5px] border-rule-soft dark:border-rule-on-dark" aria-hidden />
        <dl className="grid grid-cols-[90px_1fr] gap-x-3 gap-y-2 font-mono text-[12px]">
          {detail.requestId && (
            <>
              <dt className="uppercase tracking-eyebrow text-[10px] text-ink-mute">request_id</dt>
              <dd className="text-ink dark:text-foreground break-all">{detail.requestId}</dd>
            </>
          )}
          <dt className="uppercase tracking-eyebrow text-[10px] text-ink-mute">endpoint</dt>
          <dd className="text-ink dark:text-foreground break-all">
            {detail.method} {detail.endpoint}
          </dd>
          <dt className="uppercase tracking-eyebrow text-[10px] text-ink-mute">status</dt>
          <dd className="text-cobalt dark:text-cobalt-soft">{detail.status}</dd>
        </dl>
      </div>

      <DialogFooter className={dialogFooterClass}>
        <Button
          type="button"
          variant="outline"
          className={dialogButtonClass}
          onClick={onBack}
          disabled={retrying}
        >
          {tCommon('back')}
        </Button>
        <Button
          type="button"
          variant="accent"
          className={dialogButtonClass}
          onClick={onRetry}
          disabled={retrying}
        >
          <RotateCw className="size-3.5" />
          {retrying ? tCommon('retrying') : t('retry')}
        </Button>
      </DialogFooter>
    </>
  );
}
