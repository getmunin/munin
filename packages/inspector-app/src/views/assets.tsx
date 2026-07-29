import { useEffect, useState } from 'react';
import type { App as McpApp } from '@modelcontextprotocol/ext-apps';
import {
  errorText,
  isAssetUsageList,
  parseToolResult,
  type AssetUsageRow,
  type CmsAsset,
} from '../types';
import { Chrome } from '../chrome';
import { formatBytes } from '../format';
import { useI18n } from '../i18n';

type Usage = { rows: AssetUsageRow[] } | { error: string } | 'loading';

const DISPLAY_LIMIT = 8;

export function AssetsView({ app, initial }: { app: McpApp; initial: CmsAsset[] }) {
  const { t } = useI18n();
  const [assets] = useState<CmsAsset[]>(initial);
  const [expanded, setExpanded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [usage, setUsage] = useState<Record<string, Usage>>({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (openId === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId]);

  async function openAsset(asset: CmsAsset) {
    setOpenId(asset.id);
    setCopied(false);
    if (usage[asset.id] !== undefined) return;
    setUsage((prev) => ({ ...prev, [asset.id]: 'loading' }));
    try {
      const result = await app.callServerTool({
        name: 'cms_list_asset_usage',
        arguments: { assetId: asset.id },
      });
      const parsed = parseToolResult(result);
      setUsage((prev) => ({
        ...prev,
        [asset.id]:
          !result.isError && isAssetUsageList(parsed)
            ? { rows: parsed }
            : { error: errorText(result) },
      }));
    } catch (err) {
      setUsage((prev) => ({
        ...prev,
        [asset.id]: { error: err instanceof Error ? err.message : String(err) },
      }));
    }
  }

  async function copyUrl(url: string) {
    if (!navigator.clipboard) return;
    const ok = await navigator.clipboard.writeText(url).then(
      () => true,
      () => false,
    );
    if (ok) setCopied(true);
  }

  const truncated = assets.length > DISPLAY_LIMIT;
  const visible = expanded ? assets : assets.slice(0, DISPLAY_LIMIT);
  const open = assets.find((a) => a.id === openId) ?? null;
  const openUsage = open ? usage[open.id] : undefined;

  return (
    <Chrome context={t('chrome.contextCms')} tool="cms_list_assets">
      <div className="ledger-head">
        <div>
          <div className="eyebrow eyebrow-accent">{t('assets.eyebrow')}</div>
          <h1 className="ledger-title">{t('assets.title')}</h1>
          <p className="subline">{t('assets.subline', { count: assets.length })}</p>
        </div>
      </div>
      <div className="asset-grid">
        {visible.map((asset) => (
          <button key={asset.id} className="asset-card" onClick={() => void openAsset(asset)}>
            {asset.mime.startsWith('image/') ? (
              <img
                className="asset-thumb"
                src={asset.publicUrl}
                alt={asset.altText ?? asset.name}
                loading="lazy"
              />
            ) : (
              <span className="asset-thumb asset-thumb-file">
                {extensionOf(asset) || asset.mime.split('/')[0]}
              </span>
            )}
            <span className="asset-name">{asset.name}</span>
            <span className="asset-meta">
              {formatBytes(asset.sizeBytes)}
              {!asset.uploaded && ` · ${t('assets.notUploaded')}`}
            </span>
          </button>
        ))}
      </div>
      <div className="ledger-foot ledger-foot-bar">
        <span>
          {truncated
            ? t('assets.footShowing', { visible: visible.length, total: assets.length })
            : t('assets.foot', { count: assets.length })}
        </span>
        {truncated && (
          <button className="chip-btn" onClick={() => setExpanded((value) => !value)}>
            {expanded ? t('assets.collapse') : t('assets.showAll', { count: assets.length })}
          </button>
        )}
      </div>
      {open && (
        <div className="asset-scrim" role="presentation" onClick={() => setOpenId(null)}>
          <div
            className="asset-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={open.name}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="asset-dialog-head">
              <span className="eyebrow eyebrow-accent">{t('assets.detailEyebrow')}</span>
              <button
                className="asset-dialog-close"
                aria-label={t('assets.close')}
                onClick={() => setOpenId(null)}
              >
                ✕
              </button>
            </div>
            {open.mime.startsWith('image/') ? (
              <img
                className="asset-preview"
                src={open.publicUrl}
                alt={open.altText ?? open.name}
              />
            ) : (
              <span className="asset-preview asset-preview-file">
                {extensionOf(open) || open.mime}
              </span>
            )}
            <div className="asset-dialog-body">
              <h2 className="asset-dialog-title">{open.name}</h2>
              <p className="asset-dialog-meta">
                {open.mime} · {formatBytes(open.sizeBytes)}
                {!open.uploaded && ` · ${t('assets.notUploaded')}`}
              </p>
              {open.altText && <p className="asset-dialog-alt">{open.altText}</p>}
              <div className="asset-url">
                <a
                  className="asset-url-text"
                  href={open.publicUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {open.publicUrl}
                </a>
                <button className="chip-btn" onClick={() => void copyUrl(open.publicUrl)}>
                  {copied ? t('assets.copied') : t('assets.copyUrl')}
                </button>
              </div>
              {openUsage === 'loading' && <p className="asset-usage">{t('assets.usageLoading')}</p>}
              {openUsage !== undefined && openUsage !== 'loading' && 'error' in openUsage && (
                <p className="asset-usage asset-usage-error">{openUsage.error}</p>
              )}
              {openUsage !== undefined && openUsage !== 'loading' && 'rows' in openUsage && (
                <p className="asset-usage">
                  {openUsage.rows.length === 0
                    ? t('assets.usageNone')
                    : t('assets.usageCount', { count: openUsage.rows.length })}
                  {openUsage.rows.length > 0 &&
                    ` — ${[...new Set(openUsage.rows.map((r) => r.fieldName))].join(', ')}`}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </Chrome>
  );
}

function extensionOf(asset: CmsAsset): string {
  const dot = asset.name.lastIndexOf('.');
  return dot > 0 ? asset.name.slice(dot + 1).toUpperCase().slice(0, 5) : '';
}
