import { useState } from 'react';
import type { App as McpApp } from '@modelcontextprotocol/ext-apps';
import { errorText, isBroadcast, parseToolResult, type Broadcast } from '../types';
import { Chrome } from '../chrome';
import { formatDateTime } from '../format';
import { useI18n } from '../i18n';

type Busy = 'approve' | 'dismiss' | null;

export function BroadcastView({ app, initial }: { app: McpApp; initial: Broadcast }) {
  const { locale, t } = useI18n();
  const [broadcast, setBroadcast] = useState<Broadcast>(initial);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [showText, setShowText] = useState(false);

  async function decide(action: 'approve' | 'dismiss') {
    setBusy(action);
    setError(null);
    try {
      const result = await app.callServerTool({
        name: action === 'approve' ? 'outreach_approve_broadcast' : 'outreach_dismiss_broadcast',
        arguments:
          action === 'approve'
            ? { id: broadcast.id, fingerprint: broadcast.contentFingerprint }
            : { id: broadcast.id },
      });
      const parsed = parseToolResult(result);
      if (result.isError || !isBroadcast(parsed)) {
        setError(errorText(result));
        await reload();
        return;
      }
      setBroadcast(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function reload() {
    const result = await app.callServerTool({
      name: 'outreach_get_broadcast',
      arguments: { id: broadcast.id },
    });
    const parsed = parseToolResult(result);
    if (!result.isError && isBroadcast(parsed)) setBroadcast(parsed);
  }

  const excluded = Object.entries(broadcast.audience.excluded).filter(([, n]) => n > 0);
  const pending = broadcast.status === 'pending';
  const recipients = broadcast.approvedAudienceCount ?? broadcast.audience.eligible;

  return (
    <Chrome context={t('chrome.contextOutreach')} tool="outreach_get_broadcast">
      <div className="ledger-head">
        <div>
          <div className="eyebrow eyebrow-accent">
            {t(`broadcast.status.${broadcast.status}`)} · {broadcast.name}
          </div>
          <h1 className="ledger-title">{broadcast.subject}</h1>
          {broadcast.preheader && <p className="subline">{broadcast.preheader}</p>}
        </div>
        <button className="chip-btn" onClick={() => setShowText((v) => !v)}>
          {showText ? t('broadcast.showEmail') : t('broadcast.showText')}
        </button>
      </div>

      <p className="line">
        {recipients > 0
          ? t('broadcast.audience', { count: recipients })
          : t('broadcast.audienceNone')}
        {excluded.length > 0 &&
          ` ${t('broadcast.excluded', {
            list: excluded.map(([reason, n]) => `${n} ${t(`broadcast.reason.${reason}`)}`).join(', '),
          })}`}
      </p>
      {!pending && (
        <p className="line">
          {t('broadcast.progress', {
            sent: broadcast.counts['sent'] ?? 0,
            replied: broadcast.counts['replied'] ?? 0,
            unsubscribed: broadcast.counts['unsubscribed'] ?? 0,
          })}
        </p>
      )}
      {pending && broadcast.scheduledSendAt && (
        <p className="line">
          {t('broadcast.scheduled', { when: formatDateTime(broadcast.scheduledSendAt, locale) })}
        </p>
      )}
      {broadcast.preview.warnings.map((w) => (
        <p key={w} className="line line-error">
          {w}
        </p>
      ))}

      {showText ? (
        <pre className="evidence">{broadcast.preview.text}</pre>
      ) : (
        <iframe
          title={t('broadcast.previewTitle')}
          srcDoc={broadcast.preview.html}
          sandbox=""
          referrerPolicy="no-referrer"
          style={{ width: '100%', height: 560, border: 0, background: '#fff' }}
        />
      )}

      {error && <p className="line line-error">{error}</p>}
      {pending ? (
        <div className="actions">
          <button
            className="chip-btn chip-btn-solid"
            disabled={busy !== null || recipients === 0}
            onClick={() => void decide('approve')}
          >
            {busy === 'approve'
              ? t('broadcast.approving')
              : t('broadcast.approve', { count: recipients })}
          </button>
          <button className="chip-btn" disabled={busy !== null} onClick={() => void decide('dismiss')}>
            {busy === 'dismiss' ? t('broadcast.dismissing') : t('broadcast.dismiss')}
          </button>
        </div>
      ) : null}
      <div className="ledger-foot">{t('broadcast.foot')}</div>
    </Chrome>
  );
}
