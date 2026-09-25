'use client';

import { useTranslations } from 'next-intl';

export interface PersonalDataPanelProps {
  clientName: string;
  rawRequested: boolean;
  shareRaw: boolean;
  onShareRawChange: (next: boolean) => void;
  disabled?: boolean;
}

export function PersonalDataPanel({
  clientName,
  rawRequested,
  shareRaw,
  onShareRawChange,
  disabled,
}: PersonalDataPanelProps) {
  const t = useTranslations('dashboard.oauthConsent.personalData');
  const client = () => <b className="font-semibold text-ink">{clientName}</b>;
  const raw = rawRequested && shareRaw;
  return (
    <div className="px-7 pb-2" data-personal-data={raw ? 'raw' : 'pseudonymized'}>
      <div className="border-t-[1px] border-rule-soft py-4 dark:border-rule-on-dark">
        <div className="flex items-baseline justify-between gap-4">
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-mute">
            {t('label')}
          </span>
          <span
            className={`whitespace-nowrap rounded-full border-[1px] px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] ${
              raw
                ? 'border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
                : 'border-rule-soft text-ink-soft'
            }`}
          >
            {raw ? t('badgeRaw') : t('badgePseudonymized')}
          </span>
        </div>
        <p className="mt-2 text-[13px] leading-snug text-ink-soft [overflow-wrap:anywhere]">
          {t.rich('pseudonymizedBody', { client })}
        </p>
        {rawRequested && (
          <label className="mt-3 flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 size-3.5 shrink-0 accent-ink"
              checked={shareRaw}
              disabled={disabled}
              onChange={(e) => onShareRawChange(e.target.checked)}
            />
            <span className="flex flex-col gap-1">
              <span className="text-[14px] font-semibold text-ink">{t('shareRaw')}</span>
              <span className="text-[12.5px] leading-snug text-ink-mute [overflow-wrap:anywhere]">
                {t.rich('shareRawHint', { client })}
              </span>
            </span>
          </label>
        )}
        {raw && (
          <p
            role="note"
            className="mt-3 border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-[12.5px] leading-snug text-ink dark:bg-amber-950/30 dark:text-foreground [overflow-wrap:anywhere]"
          >
            {t.rich('rawWarning', { client })}
          </p>
        )}
      </div>
    </div>
  );
}
