import { useState } from 'react';
import type { App as McpApp } from '@modelcontextprotocol/ext-apps';
import { errorText, isCmsEntry, parseToolResult, type CmsEntry } from '../types';
import { Chrome } from '../chrome';
import { formatDateTime } from '../format';
import { useI18n, type Translator } from '../i18n';

type Busy = 'publish' | 'unpublish' | 'schedule' | null;

export function EntryView({ app, initial }: { app: McpApp; initial: CmsEntry }) {
  const { locale, t } = useI18n();
  const [entry, setEntry] = useState<CmsEntry>(initial);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [actedNow, setActedNow] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');

  async function act(action: Exclude<Busy, null>) {
    setBusy(action);
    setError(null);
    try {
      const name =
        action === 'publish'
          ? 'cms_publish_entry'
          : action === 'unpublish'
            ? 'cms_unpublish_entry'
            : 'cms_schedule_publish';
      const args: Record<string, unknown> = { id: entry.id, ifVersion: entry.version };
      if (action === 'schedule') {
        if (!scheduleAt) {
          setBusy(null);
          setError(t('entry.scheduleMissing'));
          return;
        }
        args.scheduledAt = new Date(scheduleAt).toISOString();
      }
      const result = await app.callServerTool({ name, arguments: args });
      const parsed = parseToolResult(result);
      if (result.isError || !isCmsEntry(parsed)) {
        setError(errorText(result));
      } else {
        setEntry(parsed);
        setActedNow(true);
        setScheduleOpen(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const statusLine = describeStatus(entry, actedNow, locale, t);
  const imageAssets = Object.values(entry.assets ?? {}).filter((a) =>
    a.mime.startsWith('image/'),
  );

  return (
    <Chrome context={t('chrome.contextCms')} tool="cms_get_entry">
      <div className="ledger-head">
        <div>
          <div className="eyebrow eyebrow-accent">
            {entry.collectionSlug} · {entry.locale}
          </div>
          <h1 className="ledger-title">{entryTitle(entry)}</h1>
          <p className="subline">
            {t('entry.versionLine', { version: entry.version })}
            {statusLine && ` · ${statusLine}`}
          </p>
        </div>
        <span className={`pill pill-entry-${entry.status}`}>
          <span className="pill-dot" />
          {t(`entry.status.${entry.status}`)}
        </span>
      </div>
      <div className="entry-body">
        {imageAssets.length > 0 && (
          <div className="entry-images">
            {imageAssets.map((asset) => (
              <img
                key={asset.id}
                className="entry-image"
                src={asset.publicUrl}
                alt={asset.altText ?? ''}
                loading="lazy"
              />
            ))}
          </div>
        )}
        {Object.entries(entry.data).map(([field, value]) => (
          <div className="entry-field" key={field}>
            <div className="eyebrow">{field}</div>
            <FieldValue value={value} />
          </div>
        ))}
      </div>
      {error && <p className="list-error">{error}</p>}
      <div className="entry-actions">
        {entry.status === 'published' ? (
          <button
            className="chip-btn"
            disabled={busy !== null}
            onClick={() => void act('unpublish')}
          >
            {busy === 'unpublish' ? t('entry.unpublishing') : t('entry.unpublish')}
          </button>
        ) : (
          <>
            <button
              className="chip-btn chip-btn-solid"
              disabled={busy !== null}
              onClick={() => void act('publish')}
            >
              {busy === 'publish' ? t('entry.publishing') : t('entry.publish')}
            </button>
            {scheduleOpen ? (
              <span className="schedule-controls">
                <input
                  className="target-select"
                  type="datetime-local"
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                />
                <button
                  className="chip-btn"
                  disabled={busy !== null}
                  onClick={() => void act('schedule')}
                >
                  {busy === 'schedule' ? t('entry.scheduling') : t('entry.scheduleConfirm')}
                </button>
              </span>
            ) : (
              <button className="chip-btn" disabled={busy !== null} onClick={() => setScheduleOpen(true)}>
                {t('entry.schedule')}
              </button>
            )}
          </>
        )}
      </div>
    </Chrome>
  );
}

function entryTitle(entry: CmsEntry): string {
  const candidate = Object.values(entry.data).find(
    (v) => typeof v === 'string' && v.length > 0 && v.length <= 200 && !v.includes('\n'),
  );
  return typeof candidate === 'string' ? candidate : entry.slug;
}

function describeStatus(
  entry: CmsEntry,
  actedNow: boolean,
  locale: string,
  t: Translator,
): string | null {
  if (entry.status === 'published' && entry.publishedAt) {
    return t(actedNow ? 'entry.publishedNow' : 'entry.publishedAt', {
      at: formatDateTime(entry.publishedAt, locale),
    });
  }
  if (entry.status === 'scheduled' && entry.scheduledAt) {
    return t('entry.scheduledFor', { at: formatDateTime(entry.scheduledAt, locale) });
  }
  return null;
}

function FieldValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <p className="mute">—</p>;
  }
  if (typeof value === 'string') {
    return (
      <div className="entry-prose">
        {value.split(/\n{2,}/).map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>
    );
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <p>{String(value)}</p>;
  }
  return <pre className="evidence">{JSON.stringify(value, null, 2)}</pre>;
}
