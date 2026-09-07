'use client';

import { useTranslations } from 'next-intl';
import { CopyField } from '../copy-field';
import { MCP_ENDPOINT } from './first-run-links';
import { FirstRunFootnote, FirstRunNote, FirstRunScene } from './first-run-scene';
import { FirstRunFigures } from './first-run-status';
import type { SetupState } from './use-setup-state';

export function ReviewFirstRun({
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
        eyebrow={t('review.eyebrow')}
        title={t.rich('review.titleEmptyBase', { em: (chunks) => <em>{chunks}</em> })}
        lede={t.rich('review.ledeEmptyBase', { code: (chunks) => <code>{chunks}</code> })}
      >
        <CopyField value={MCP_ENDPOINT} className="max-w-[460px]" />
        <FirstRunNote>{t('review.noteEmptyBase')}</FirstRunNote>
      </FirstRunScene>
    );
  }

  return (
    <FirstRunScene
      eyebrow={t('review.eyebrow')}
      title={t.rich('review.titleStocked', { em: (chunks) => <em>{chunks}</em> })}
      lede={t('review.ledeStocked', { count: entries })}
    >
      <FirstRunFigures
        figures={[
          { key: 'entries', label: t('review.figureEntries'), value: entries },
          { key: 'gaps', label: t('review.figureGaps'), value: 0, muted: true },
          {
            key: 'decided',
            label: t('review.figureDecided'),
            value: decidedCount,
            muted: decidedCount === 0,
          },
        ]}
      />
      <FirstRunFootnote>{t('review.footnoteStocked')}</FirstRunFootnote>
    </FirstRunScene>
  );
}
