'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Hero } from '@getmunin/ui';
import type { ProviderPreset } from '../components/agent-config/types';
import { useAgentConfig } from '../components/agent-config/use-agent-config';
import { ProviderCard } from '../components/agent-config/provider-card';
import { ModelsCard } from '../components/agent-config/models-card';
import { ChatAssistantCard } from '../components/assistants/chat-assistant-card';
import { BackgroundSkillCard } from '../components/assistants/background-skill-card';
import { IdentityCard } from '../components/assistants/identity-card';
import { useAssistant } from '../components/assistants/use-assistant';
import { useSkills } from '../components/assistants/use-skills';
import { LoadFailed } from '../components/load-failed';
import { useSettingsLoadFailedProps } from '../lib/use-load-failed-props';

interface AiSettingsPageProps {
  extraPresets?: ProviderPreset[];
  defaultPresetId?: string;
  providerLede?: string;
  slot?: ReactNode;
}

export function AiSettingsPage({
  extraPresets,
  defaultPresetId,
  providerLede,
  slot,
}: AiSettingsPageProps = {}) {
  const t = useTranslations('agentSetup');
  const tList = useTranslations('assistants.list');
  const tCommon = useTranslations('common');

  const {
    config,
    loadError: configError,
    hasLoadedOnce: configLoaded,
    retrying,
    retry,
    models,
    setConfig,
    setModels,
  } = useAgentConfig();
  const { assistant, setAssistant } = useAssistant();
  const { skills } = useSkills();

  const buildLoadFailedProps = useSettingsLoadFailedProps();

  if (configError && !configLoaded) {
    return (
      <LoadFailed
        {...buildLoadFailedProps('ai', configError, () => void retry(), retrying)}
      />
    );
  }

  const conversationalSkills = skills?.filter(isConversational) ?? [];
  const remainingSkills = skills?.filter((s) => !isConversational(s)) ?? [];
  const aiDrivenSkills = remainingSkills.filter((s) => s.kind === 'skill');
  const scheduledTasks = remainingSkills.filter((s) => s.kind === 'task');

  const managedPreset = (extraPresets ?? []).find((p) => p.managed);
  const isManaged = !!managedPreset && config != null && !config.providerApiKeySet;
  const managedModelsResult =
    isManaged && (managedPreset?.models?.length ?? 0) > 0
      ? { supported: true, models: managedPreset?.models ?? [] }
      : null;

  return (
    <div className="max-w-3xl space-y-10">
      <Hero
        eyebrow={t('settings.eyebrow')}
        title={t.rich('settings.title', { em: (chunks) => <em>{chunks}</em> })}
        lede={t('settings.lede')}
      />

      {slot}

      {config === null && (
        <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
      )}

      {config && (
        <div className="space-y-10">
          <section className="space-y-4">
            <SectionHeader title={tList('persona.title')} blurb={tList('persona.blurb')} />
            <div className="space-y-6">
              {assistant ? (
                <IdentityCard assistant={assistant} onSaved={setAssistant} />
              ) : (
                <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
              )}
            </div>
          </section>

          <section className="space-y-4">
            <SectionHeader title={tList('models.title')} blurb={tList('models.blurb')} />
            <div className="space-y-6">
              <ProviderCard
                config={config}
                extraPresets={extraPresets}
                defaultPresetId={defaultPresetId}
                lede={providerLede}
                onSaved={(updated, result) => {
                  setConfig(updated);
                  setModels(result);
                }}
              />
              <ModelsCard
                config={config}
                models={managedModelsResult ?? models}
                managed={isManaged}
                onSaved={setConfig}
              />
            </div>
          </section>

          <section className="space-y-4">
            <SectionHeader
              title={tList('conversational.title')}
              blurb={tList('conversational.blurb')}
            />
            <div className="space-y-3">
              <ChatAssistantCard />
              {conversationalSkills.map((skill) => (
                <BackgroundSkillCard key={skill.uri} skill={skill} />
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <SectionHeader
              title={tList('aiDriven.title')}
              blurb={tList('aiDriven.blurb')}
            />
            <div className="space-y-3">
              {skills === null ? (
                <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
              ) : aiDrivenSkills.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tList('aiDriven.empty')}</p>
              ) : (
                aiDrivenSkills.map((skill) => (
                  <BackgroundSkillCard key={skill.uri} skill={skill} />
                ))
              )}
            </div>
          </section>

          <section className="space-y-4">
            <SectionHeader
              title={tList('tasks.title')}
              blurb={tList('tasks.blurb')}
            />
            <div className="space-y-3">
              {skills === null ? (
                <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
              ) : scheduledTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tList('tasks.empty')}</p>
              ) : (
                scheduledTasks.map((skill) => (
                  <BackgroundSkillCard key={skill.uri} skill={skill} />
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function SectionHeader({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{blurb}</p>
    </div>
  );
}

function isConversational(skill: { uri: string }): boolean {
  return (
    skill.uri === 'skill://outreach/draft-reply-email' ||
    skill.uri === 'skill://outreach/draft-initial-email'
  );
}
