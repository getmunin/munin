'use client';

import { useTranslations } from 'next-intl';
import { Hero } from '@getmunin/ui';
import { useAgentConfig } from '../components/agent-config/use-agent-config';
import { ProviderCard } from '../components/agent-config/provider-card';
import { ModelsCard } from '../components/agent-config/models-card';
import { ChatAssistantCard } from '../components/assistants/chat-assistant-card';
import { BackgroundSkillCard } from '../components/assistants/background-skill-card';
import { useAssistant } from '../components/assistants/use-assistant';
import { useSkills } from '../components/assistants/use-skills';
import { LoadFailed } from '../components/load-failed';
import { useSettingsLoadFailedProps } from '../lib/use-load-failed-props';

export function AssistantsSettingsPage() {
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
  const { assistant } = useAssistant();
  const { skills } = useSkills();

  const buildLoadFailedProps = useSettingsLoadFailedProps();

  if (configError && !configLoaded) {
    return (
      <LoadFailed
        {...buildLoadFailedProps('assistants', configError, () => void retry(), retrying)}
      />
    );
  }

  const conversationalSkills = skills?.filter(isConversational) ?? [];
  const remainingSkills = skills?.filter((s) => !isConversational(s)) ?? [];
  const aiDrivenSkills = remainingSkills.filter((s) => s.kind === 'skill');
  const scheduledTasks = remainingSkills.filter((s) => s.kind === 'task');

  return (
    <>
      <Hero
        eyebrow={t('settings.eyebrow')}
        title={t.rich('settings.title', { em: (chunks) => <em>{chunks}</em> })}
        lede={t('settings.lede')}
      />

      {config === null && (
        <p className="mt-6 text-sm text-muted-foreground">{tCommon('loading')}</p>
      )}

      {config && (
        <div className="mt-8 space-y-10">
          <section className="space-y-4">
            <SectionHeader title={tList('engine.title')} blurb={tList('engine.blurb')} />
            <div className="space-y-6">
              <ProviderCard
                config={config}
                onSaved={(updated, result) => {
                  setConfig(updated);
                  setModels(result);
                }}
              />
              <ModelsCard config={config} models={models} onSaved={setConfig} />
            </div>
          </section>

          <section className="space-y-4">
            <SectionHeader
              title={tList('conversational.title')}
              blurb={tList('conversational.blurb')}
            />
            <div className="space-y-3">
              <ChatAssistantCard assistant={assistant} />
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
    </>
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

/**
 * Skills that *speak* to end-users in a conversation surface (chat, email
 * replies, outreach drafts) rather than running silently in the background.
 * Today this is just the outreach drafters; the main chat assistant is its
 * own card. As we add more user-facing surfaces, list their URIs here.
 */
function isConversational(skill: { uri: string }): boolean {
  return (
    skill.uri === 'skill://outreach/draft-reply' ||
    skill.uri === 'skill://outreach/draft-initial'
  );
}
