'use client';

import { useTranslations } from 'next-intl';
import { CopyField } from '../copy-field';
import { MCP_ENDPOINT } from './first-run-links';
import { FirstRunFootnote, FirstRunNote, FirstRunScene } from './first-run-scene';
import { FirstRunFigures } from './first-run-status';
import type { SetupState } from './use-setup-state';

export function LearningFirstRun({
  setup,
  decidedCount,
}: {
  setup: SetupState;
  decidedCount: number;
}) {
  const t = useTranslations('dashboard.firstRun');
  const entries = setup.knowledgeDocumentCount;

  if (entries === 0) {
    return (
      <FirstRunScene
        eyebrow={t('learning.eyebrow')}
        title={t.rich('learning.titleEmptyBase', { em: (chunks) => <em>{chunks}</em> })}
        lede={t.rich('learning.ledeEmptyBase', { code: (chunks) => <code>{chunks}</code> })}
      >
        <CopyField value={MCP_ENDPOINT} className="max-w-[460px]" />
        <FirstRunNote>{t('learning.noteEmptyBase')}</FirstRunNote>
      </FirstRunScene>
    );
  }

  return (
    <FirstRunScene
      eyebrow={t('learning.eyebrow')}
      title={t.rich('learning.titleStocked', { em: (chunks) => <em>{chunks}</em> })}
      lede={t('learning.ledeStocked', { count: entries })}
    >
      <FirstRunFigures
        figures={[
          { key: 'entries', label: t('learning.figureEntries'), value: entries },
          { key: 'gaps', label: t('learning.figureGaps'), value: 0, muted: true },
          {
            key: 'decided',
            label: t('learning.figureDecided'),
            value: decidedCount,
            muted: decidedCount === 0,
          },
        ]}
      />
      <FirstRunFootnote>{t('learning.footnoteStocked')}</FirstRunFootnote>
    </FirstRunScene>
  );
}
