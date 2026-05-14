'use client';

import { useTranslations } from 'next-intl';
import { Hero } from '@getmunin/ui';
import { IdentityCard } from '../components/assistants/identity-card';
import { useAssistant } from '../components/assistants/use-assistant';
import { LoadFailed } from '../components/load-failed';
import { useSettingsLoadFailedProps } from '../lib/use-load-failed-props';

export function AssistantChatSettingsPage() {
  const t = useTranslations('assistants.chat');
  const tCommon = useTranslations('common');
  const { assistant, loadError, hasLoadedOnce, retrying, retry, setAssistant } = useAssistant();
  const buildLoadFailedProps = useSettingsLoadFailedProps();

  if (loadError && !hasLoadedOnce) {
    return (
      <LoadFailed
        {...buildLoadFailedProps('assistants', loadError, () => void retry(), retrying)}
      />
    );
  }

  return (
    <>
      <Hero eyebrow={t('eyebrow')} title={t('title')} lede={t('lede')} />

      {assistant === null && (
        <p className="mt-6 text-sm text-muted-foreground">{tCommon('loading')}</p>
      )}

      {assistant && (
        <div className="mt-8 space-y-6">
          <IdentityCard assistant={assistant} onSaved={setAssistant} />
        </div>
      )}
    </>
  );
}
