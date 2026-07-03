import { useEffect, useMemo, useState } from 'react';
import { App as McpApp } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { isProposalList, parseToolResult } from './types';
import { Chrome } from './chrome';
import { createT, resolveLocale, I18nProvider } from './i18n';
import { ProposalsView } from './views/proposals';

const mcpApp = new McpApp({ name: 'Munin Inspector', version: '0.2.0' });

type Connection = 'connecting' | 'connected' | 'failed';

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
    };
    mcpApp
      .connect()
      .then(() => {
        setConnection('connected');
        const context = mcpApp.getHostContext();
        console.log('[Munin Inspector] host context:', context);
        if (context?.locale) setLocale(resolveLocale(context.locale));
      })
      .catch((err: unknown) => {
        setConnection('failed');
        setConnectionError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  const i18n = useMemo(() => ({ locale, t: createT(locale) }), [locale]);
  const { t } = i18n;

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
      ) : isProposalList(payload) ? (
        <ProposalsView app={mcpApp} initial={payload} />
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
