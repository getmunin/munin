import { Chrome } from '../chrome';
import { formatCount, formatDay, formatDateTime } from '../format';
import { useI18n } from '../i18n';
import type { DayPoint, Funnel, JourneyEvent, TrafficSourceRow } from '../types';

export type AnalyticsPayload =
  | { kind: 'series'; rows: DayPoint[] }
  | { kind: 'sources'; rows: TrafficSourceRow[] }
  | { kind: 'funnel'; funnel: Funnel }
  | { kind: 'journey'; rows: JourneyEvent[] };

const TOOL_BY_KIND: Record<AnalyticsPayload['kind'], string> = {
  series: 'analytics_get_views_over_time',
  sources: 'analytics_get_traffic_by_source',
  funnel: 'analytics_get_funnel',
  journey: 'analytics_get_contact_journey',
};

export function AnalyticsView({ payload }: { payload: AnalyticsPayload }) {
  const { t } = useI18n();
  return (
    <Chrome context={t('chrome.contextAnalytics')} tool={TOOL_BY_KIND[payload.kind]}>
      <div className="ledger-head">
        <div>
          <div className="eyebrow eyebrow-accent">{t('charts.eyebrow')}</div>
          <h1 className="ledger-title">{t(`charts.title.${payload.kind}`)}</h1>
          <Subline payload={payload} />
        </div>
      </div>
      <div className="chart-body">
        {payload.kind === 'series' && <SeriesChart rows={payload.rows} />}
        {payload.kind === 'sources' && <SourceBars rows={payload.rows} />}
        {payload.kind === 'funnel' && <FunnelBars funnel={payload.funnel} />}
        {payload.kind === 'journey' && <JourneyTimeline rows={payload.rows} />}
      </div>
    </Chrome>
  );
}

function Subline({ payload }: { payload: AnalyticsPayload }) {
  const { locale, t } = useI18n();
  switch (payload.kind) {
    case 'series': {
      const views = payload.rows.reduce((sum, r) => sum + r.views, 0);
      const days = payload.rows.length;
      return (
        <p className="subline">
          {t('charts.seriesSubline', { views: formatCount(views, locale), days })}
        </p>
      );
    }
    case 'sources': {
      const views = payload.rows.reduce((sum, r) => sum + r.views, 0);
      return (
        <p className="subline">
          {t('charts.sourcesSubline', {
            sources: payload.rows.length,
            views: formatCount(views, locale),
          })}
        </p>
      );
    }
    case 'funnel': {
      const first = payload.funnel.steps[0]?.actors ?? 0;
      const last = payload.funnel.steps[payload.funnel.steps.length - 1]?.actors ?? 0;
      const rate = first > 0 ? Math.round((last / first) * 100) : 0;
      return (
        <p className="subline">
          {t('charts.funnelSubline', { rate, days: payload.funnel.sinceDays })}
        </p>
      );
    }
    case 'journey':
      return <p className="subline">{t('charts.journeySubline', { count: payload.rows.length })}</p>;
  }
}

const CHART_W = 640;
const CHART_H = 150;
const CHART_PAD_BOTTOM = 22;

function SeriesChart({ rows }: { rows: DayPoint[] }) {
  const { locale, t } = useI18n();
  const max = Math.max(1, ...rows.map((r) => r.views));
  const innerH = CHART_H - CHART_PAD_BOTTOM;
  const step = CHART_W / rows.length;
  const barW = Math.max(1, Math.min(24, step - 2));
  const labelEvery = Math.max(1, Math.ceil(rows.length / 8));
  const peak = rows.reduce<DayPoint | undefined>(
    (best, r) => (!best || r.views > best.views ? r : best),
    undefined,
  );
  return (
    <>
      <svg
        className="chart"
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        role="img"
        aria-label={t('charts.title.series')}
      >
        {rows.map((r, i) => {
          const h = Math.round((r.views / max) * (innerH - 4));
          const x = i * step + (step - barW) / 2;
          return (
            <rect
              key={r.day}
              className={r === peak ? 'chart-bar chart-bar-peak' : 'chart-bar'}
              x={x}
              y={innerH - h}
              width={barW}
              height={Math.max(r.views > 0 ? 1 : 0, h)}
            >
              <title>{`${formatDay(r.day, locale)} · ${formatCount(r.views, locale)} / ${formatCount(r.visitors, locale)}`}</title>
            </rect>
          );
        })}
        {rows.map((r, i) =>
          i % labelEvery === 0 ? (
            <text
              key={`label-${r.day}`}
              className="chart-label"
              x={i * step + step / 2}
              y={CHART_H - 6}
              textAnchor="middle"
            >
              {formatDay(r.day, locale)}
            </text>
          ) : null,
        )}
      </svg>
      <p className="chart-legend">
        {t('charts.seriesLegend', {
          max: formatCount(max, locale),
          peak: peak ? formatDay(peak.day, locale) : '—',
        })}
      </p>
    </>
  );
}

function SourceBars({ rows }: { rows: TrafficSourceRow[] }) {
  const { locale, t } = useI18n();
  const max = Math.max(1, ...rows.map((r) => r.views));
  return (
    <div className="hbar-list">
      {rows.map((r, i) => {
        const label = r.utmSource ?? t('charts.directBucket');
        const detail = [r.utmMedium, r.utmCampaign].filter(Boolean).join(' · ');
        return (
          <div className="hbar" key={`${r.utmSource ?? 'direct'}-${i}`}>
            <div className="hbar-head">
              <span className="hbar-label">
                <b>{label}</b>
                {detail && <span className="mute"> · {detail}</span>}
              </span>
              <span className="hbar-value">
                {t('charts.viewsVisitors', {
                  views: formatCount(r.views, locale),
                  visitors: formatCount(r.visitors, locale),
                })}
              </span>
            </div>
            <div className="hbar-track">
              <div className="hbar-fill" style={{ width: `${(r.views / max) * 100}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FunnelBars({ funnel }: { funnel: Funnel }) {
  const { locale, t } = useI18n();
  const first = Math.max(1, funnel.steps[0]?.actors ?? 1);
  return (
    <div className="hbar-list">
      {funnel.steps.map((step) => (
        <div className="hbar" key={step.index}>
          <div className="hbar-head">
            <span className="hbar-label">
              <span className="funnel-index">{step.index + 1}</span>
              <b>{step.label}</b>
            </span>
            <span className="hbar-value">
              {formatCount(step.actors, locale)}
              {step.conversionFromPrev !== null && (
                <span className="mute">
                  {' '}
                  · {t('charts.funnelConversion', {
                    rate: Math.round(step.conversionFromPrev * 100),
                  })}
                </span>
              )}
            </span>
          </div>
          <div className="hbar-track">
            <div className="hbar-fill" style={{ width: `${(step.actors / first) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function JourneyTimeline({ rows }: { rows: JourneyEvent[] }) {
  const { locale, t } = useI18n();
  return (
    <div className="journey">
      {rows.map((event, i) => {
        const what =
          event.kind === 'search'
            ? t('charts.journeySearched', { query: event.query ?? '' })
            : (event.path ??
              [event.subjectType, event.subjectId].filter(Boolean).join(' · ') ??
              t('charts.journeyViewed'));
        return (
          <div className="journey-row" key={`${event.at}-${i}`}>
            <span className={`journey-dot journey-dot-${event.kind}`} />
            <span className="journey-what">
              {event.kind === 'search' ? what : <b>{what}</b>}
              {event.kind === 'view' && event.subjectType && event.path && (
                <span className="mute"> · {event.subjectType}</span>
              )}
            </span>
            <span className="journey-at">{formatDateTime(event.at, locale)}</span>
          </div>
        );
      })}
    </div>
  );
}
