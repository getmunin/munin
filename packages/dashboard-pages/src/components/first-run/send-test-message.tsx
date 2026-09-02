'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@getmunin/ui';
import { api } from '../../api';
import { useTranslateError } from '../../i18n/translate-error';
import { notify } from '../../lib/notify';

export function SendTestMessage({ onSent }: { onSent: () => void | Promise<void> }) {
  const t = useTranslations('dashboard.firstRun.conversations');
  const translateErr = useTranslateError();
  const [pending, setPending] = useState(false);

  const send = async () => {
    setPending(true);
    try {
      await api<{ id: string }>('/v1/conversations/test-message', { method: 'POST' });
      await onSent();
    } catch (err) {
      notify.error(translateErr(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <Button
        variant="accentOutline"
        disabled={pending}
        pending={pending}
        onClick={() => void send()}
      >
        {pending ? t('sendingTest') : t('sendTest')}
      </Button>
      <span className="max-w-[46ch] text-[13.5px] leading-relaxed text-ink-mute">
        {t('sendTestHint')}
      </span>
    </div>
  );
}
