'use client';

import { useTranslations } from 'next-intl';
import { isOwnerOrAdmin, useActiveRole } from '../../auth/use-active-role';
import { FIRST_RUN_ROUTES, FirstRunLink } from './first-run-links';
import {
  FirstRunActions,
  FirstRunFootnote,
  FirstRunPassage,
  FirstRunScene,
} from './first-run-scene';
import { FirstRunStatusList } from './first-run-status';
import { SendTestMessage } from './send-test-message';
import { useChannelKindLabel } from './use-channel-kind-label';
import type { SetupState } from './use-setup-state';

export function ConversationsFirstRun({ setup }: { setup: SetupState }) {
  const t = useTranslations('dashboard.firstRun');
  const channelKind = useChannelKindLabel();
  const { role } = useActiveRole();
  const unconfigured = setup.stage === 'unconfigured';

  return (
    <FirstRunScene
      eyebrow={t('conversations.eyebrow')}
      title={t.rich(
        unconfigured ? 'conversations.titleUnconfigured' : 'conversations.titleListening',
        { em: (chunks) => <em>{chunks}</em> },
      )}
      lede={unconfigured ? t('conversations.ledeUnconfigured') : undefined}
    >
      {unconfigured ? (
        <>
          <FirstRunActions>
            <FirstRunLink href={FIRST_RUN_ROUTES.channels} accent>
              {t('actions.connectChannel')}
            </FirstRunLink>
          </FirstRunActions>
          <FirstRunFootnote>{t('conversations.footnoteUnconfigured')}</FirstRunFootnote>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-5 md:gap-6">
            <FirstRunStatusList
              rows={setup.liveChannels.map((channel) => ({
                key: channel.id,
                kind: channelKind(channel.type),
                live: true,
                detail: channel.label,
              }))}
              trailingRule
            />
            <FirstRunPassage>{t('conversations.ledeListening')}</FirstRunPassage>
          </div>
          {isOwnerOrAdmin(role) ? <SendTestMessage onSent={setup.reload} /> : null}
        </>
      )}
    </FirstRunScene>
  );
}
