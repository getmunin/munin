'use client';

import { useTranslations } from 'next-intl';
import { FIRST_RUN_ROUTES, FirstRunLink } from './first-run-links';
import { FirstRunActions, FirstRunNote, FirstRunScene } from './first-run-scene';
import { FirstRunChain } from './first-run-steps';
import type { SetupState } from './use-setup-state';

export function AutomationFirstRun({ setup }: { setup: SetupState }) {
  const t = useTranslations('dashboard.firstRun');
  const channelOpen = setup.liveChannels.length > 0;

  return (
    <FirstRunScene
      eyebrow={t('automation.eyebrow')}
      title={t.rich('automation.title', { em: (chunks) => <em>{chunks}</em> })}
      lede={t('automation.lede')}
    >
      <FirstRunChain
        steps={[
          {
            key: 'channel',
            done: channelOpen,
            title: t('automation.chainChannelTitle'),
            note: t(channelOpen ? 'automation.chainChannelNoteDone' : 'automation.chainChannelNoteTodo'),
            tag: channelOpen ? t('tagDone') : t('tagNotDone'),
          },
          {
            key: 'classify',
            title: t('automation.chainClassifyTitle'),
            note: t('automation.chainClassifyNote'),
            tag: channelOpen ? t('tagWaiting') : t('tagBlocked'),
          },
          {
            key: 'topics',
            title: t('automation.chainTopicsTitle'),
            note: t('automation.chainTopicsNote'),
            tag: t('tagLater'),
          },
        ]}
      />

      {channelOpen ? null : (
        <FirstRunActions>
          <FirstRunLink href={FIRST_RUN_ROUTES.channels} accent>
            {t('automation.startWithChannel')}
          </FirstRunLink>
        </FirstRunActions>
      )}

      <FirstRunNote>{t('automation.note')}</FirstRunNote>
    </FirstRunScene>
  );
}
