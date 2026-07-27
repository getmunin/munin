import { useEffect, useMemo, useState } from 'react';
import { App as McpApp, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  isCmsAssetList,
  isCmsEntry,
  isCurationCandidateList,
  isDayPointList,
  isEmptyList,
  isFunnel,
  isJourneyList,
  isMergeProposalList,
  isProposalList,
  isTrafficSourceList,
  parseToolResult,
} from './types';
import { Chrome } from './chrome';
import { createT, resolveLocale, I18nProvider } from './i18n';
import { ProposalsView } from './views/proposals';
import { MergeProposalsView } from './views/merge-proposals';
import { CurationView } from './views/curation';
import { AnalyticsView, type AnalyticsPayload } from './views/analytics';
import { EntryView } from './views/entry';
import { AssetsView } from './views/assets';

const mcpApp = new McpApp({ name: 'Munin Inspector', version: '0.3.0' });

type Connection = 'connecting' | 'connected' | 'failed';

function analyticsPayload(payload: unknown): AnalyticsPayload | null {
  if (isFunnel(payload)) return { kind: 'funnel', funnel: payload };
  if (isJourneyList(payload)) return { kind: 'journey', rows: payload };
  if (isTrafficSourceList(payload)) return { kind: 'sources', rows: payload };
  if (isDayPointList(payload)) return { kind: 'series', rows: payload };
  return null;
}

export function InspectorApp() {
  const [connection, setConnection] = useState<Connection>('connecting');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [payload, setPayload] = useState<unknown>(null);
  const [locale, setLocale] = useState(() => resolveLocale(undefined));

  useEffect(() => {
    mcpApp.ontoolresult = (result: CallToolResult) => {
      setPayload(parseToolResult(result));
    };
    mcpApp.onhostcontextchanged = (params) => {
      console.log('[Munin Inspector] host context changed:', params);
      if (params.locale) setLocale(resolveLocale(params.locale));
      if (params.styles?.variables) applyHostStyleVariables(params.styles.variables);
      if (params.platform) {
        document.body.classList.toggle('host-mobile', params.platform === 'mobile');
      }
    };
    mcpApp
      .connect()
      .then(() => {
        setConnection('connected');
        const context = mcpApp.getHostContext();
        console.log('[Munin Inspector] host context:', context);
        if (context?.locale) setLocale(resolveLocale(context.locale));
        if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
        document.body.classList.toggle('host-mobile', context?.platform === 'mobile');
      })
      .catch((err: unknown) => {
        setConnection('failed');
        setConnectionError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  const i18n = useMemo(() => ({ locale, t: createT(locale) }), [locale]);
  const { t } = i18n;
  const charts = connection === 'connected' ? analyticsPayload(payload) : null;

  return (
    <I18nProvider value={i18n}>
      {connection === 'failed' ? (
        <Chrome context={t('chrome.contextInspector')} tool="—">
          <div className="plain">
            <p className="line line-error">{t('connect.failed', { error: connectionError ?? '' })}</p>
          </div>
        </Chrome>
      ) : connection === 'connecting' ? (
        <Chrome context={t('chrome.contextInspector')} tool="—">
          <div className="plain">
            <p className="status">{t('connect.connecting')}</p>
          </div>
        </Chrome>
      ) : isMergeProposalList(payload) ? (
        <MergeProposalsView app={mcpApp} initial={payload} />
      ) : isProposalList(payload) ? (
        <ProposalsView app={mcpApp} initial={payload} />
      ) : isCurationCandidateList(payload) ? (
        <CurationView app={mcpApp} initial={payload} />
      ) : isCmsEntry(payload) ? (
        <EntryView app={mcpApp} initial={payload} />
      ) : isCmsAssetList(payload) ? (
        <AssetsView app={mcpApp} initial={payload} />
      ) : charts ? (
        <AnalyticsView payload={charts} />
      ) : isEmptyList(payload) ? (
        <Chrome context={t('chrome.contextInspector')} tool="—">
          <div className="plain">
            <h1>{t('fallback.title')}</h1>
            <p className="status">{t('fallback.empty')}</p>
          </div>
        </Chrome>
      ) : (
        <Chrome context={t('chrome.contextInspector')} tool="—">
          <div className="plain">
            <h1>{t('fallback.title')}</h1>
            <p className="status">{payload === null ? t('fallback.waiting') : t('fallback.raw')}</p>
            {payload !== null && <pre className="payload">{JSON.stringify(payload, null, 2)}</pre>}
          </div>
        </Chrome>
      )}
    </I18nProvider>
  );
}
