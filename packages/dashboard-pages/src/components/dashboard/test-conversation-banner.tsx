'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@getmunin/ui';
import { api } from '../../api';
import { useTranslateError } from '../../i18n/translate-error';
import { notify } from '../../lib/notify';

export function TestConversationBanner({
  conversationId,
  onDeleted,
}: {
  conversationId: string;
  onDeleted?: () => void | Promise<void>;
}) {
  const t = useTranslations('dashboard.firstRun.conversations');
  const translateErr = useTranslateError();
  const [pending, setPending] = useState(false);

  const remove = async () => {
    setPending(true);
    try {
      await api(`/v1/conversations/test-message/${conversationId}`, { method: 'DELETE' });
      await onDeleted?.();
    } catch (err) {
      notify.error(translateErr(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mx-5 mt-4 flex flex-wrap items-center gap-x-3.5 gap-y-2.5 border border-cobalt bg-paper px-3.5 py-2.5 md:mx-7 dark:border-cobalt-soft dark:bg-card">
      <span className="font-mono text-[9px] uppercase tracking-eyebrow text-cobalt dark:text-cobalt-soft">
        {t('testBadge')}
      </span>
      <span className="min-w-[200px] flex-1 text-[13.5px] leading-relaxed text-ink-soft dark:text-foreground/80">
        {t('testBannerBody')}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        pending={pending}
        onClick={() => void remove()}
        className="ml-auto"
      >
        {t('testDelete')}
      </Button>
    </div>
  );
}
