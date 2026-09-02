'use client';

import { useTranslations } from 'next-intl';
import { CopyField } from '../copy-field';
import { FIRST_RUN_DOCS, FIRST_RUN_ROUTES, FirstRunLink, MCP_ENDPOINT } from './first-run-links';
import { FirstRunAside, FirstRunNote, FirstRunScene } from './first-run-scene';
import { FirstRunSteps } from './first-run-steps';
import { FirstRunStatusList, type FirstRunStatusRow } from './first-run-status';
import { useChannelKindLabel } from './use-channel-kind-label';
import type { SetupState } from './use-setup-state';

export function OverviewFirstRun({ setup }: { setup: SetupState }) {
  return setup.stage === 'unconfigured' ? (
    <UnconfiguredOverview setup={setup} />
  ) : (
    <ListeningOverview setup={setup} />
  );
}

function stepsDone(setup: SetupState): number {
  return (setup.agentConnected ? 1 : 0) + (setup.liveChannels.length > 0 ? 1 : 0);
}

function UnconfiguredOverview({ setup }: { setup: SetupState }) {
  const t = useTranslations('dashboard.firstRun');
  return (
    <FirstRunScene
      eyebrow={t('overview.eyebrowSetup', { done: stepsDone(setup) })}
      title={t.rich('overview.titleUnconfigured', { em: (chunks) => <em>{chunks}</em> })}
      lede={t('overview.ledeUnconfigured')}
    >
      <FirstRunSteps
        steps={[
          {
            key: 'endpoint',
            done: setup.agentConnected,
            tag: setup.agentConnected ? t('tagDone') : t('tagNotDone'),
            title: t('overview.stepEndpointTitle'),
            body: t.rich('overview.stepEndpointBody', {
              code: (chunks) => <code>{chunks}</code>,
            }),
            actions: (
              <>
                <CopyField value={MCP_ENDPOINT} className="mb-1 max-w-[460px] basis-full" />
                <FirstRunLink href={FIRST_RUN_DOCS.connectClient} accent>
                  {t('actions.clientSetup')}
                </FirstRunLink>
              </>
            ),
          },
          {
            key: 'channel',
            done: setup.liveChannels.length > 0,
            tag: setup.liveChannels.length > 0 ? t('tagDone') : t('tagNotDone'),
            title: t('overview.stepChannelTitle'),
            body: t('overview.stepChannelBody'),
            actions: (
              <FirstRunLink href={FIRST_RUN_ROUTES.channels} accent>
                {t('actions.connectChannel')}
              </FirstRunLink>
            ),
          },
        ]}
      />

      <FirstRunNote>{t('overview.noteUnconfigured')}</FirstRunNote>
    </FirstRunScene>
  );
}

function ListeningOverview({ setup }: { setup: SetupState }) {
  const t = useTranslations('dashboard.firstRun');
  const channelKind = useChannelKindLabel();

  const rows: FirstRunStatusRow[] = setup.liveChannels.map((channel) => ({
    key: channel.id,
    kind: channelKind(channel.type),
    live: true,
    detail: (
      <>
        {channel.label} <span>— {t('overview.channelAccepting')}</span>
      </>
    ),
  }));
  rows.push({
    key: 'endpoint',
    kind: t('overview.rowEndpoint'),
    live: setup.agentConnected,
    detail: (
      <>
        <code>{MCP_ENDPOINT}</code>{' '}
        <span>
          —{' '}
          {setup.agentConnected
            ? t('overview.endpointCalls', { count: setup.externalMcpCallCount })
            : t('overview.endpointIdle')}
        </span>
      </>
    ),
  });

  return (
    <FirstRunScene
      eyebrow={t('overview.eyebrowSetup', { done: stepsDone(setup) })}
      title={t.rich('overview.titleListening', { em: (chunks) => <em>{chunks}</em> })}
      lede={t('overview.ledeListening')}
    >
      <FirstRunStatusList rows={rows} />

      <FirstRunAside label={t('overview.waitLabel')}>{t('overview.waitBody')}</FirstRunAside>

      <FirstRunNote>{t('overview.noteListening')}</FirstRunNote>
    </FirstRunScene>
  );
}
