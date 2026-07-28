import { useState } from 'react';
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

export function AssetsView({ app, initial }: { app: McpApp; initial: CmsAsset[] }) {
  const { t } = useI18n();
  const [assets] = useState<CmsAsset[]>(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const [usage, setUsage] = useState<Record<string, Usage>>({});

  async function toggle(asset: CmsAsset) {
    const next = openId === asset.id ? null : asset.id;
    setOpenId(next);
    if (!next || usage[asset.id] !== undefined) return;
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
        {assets.map((asset) => (
          <button
            key={asset.id}
            className={`asset-card${openId === asset.id ? ' asset-card-open' : ''}`}
            onClick={() => void toggle(asset)}
          >
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
      {open && (
        <div className="asset-detail">
          <div className="eyebrow">{open.name}</div>
          <p className="asset-detail-line">
            {open.mime} · {formatBytes(open.sizeBytes)}
            {open.altText && ` · ${open.altText}`}
          </p>
          <p className="asset-detail-line">
            <a href={open.publicUrl} target="_blank" rel="noreferrer">
              {open.publicUrl}
            </a>
          </p>
          {openUsage === 'loading' && <p className="mute">{t('assets.usageLoading')}</p>}
          {openUsage !== undefined && openUsage !== 'loading' && 'error' in openUsage && (
            <p className="line line-error">{openUsage.error}</p>
          )}
          {openUsage !== undefined && openUsage !== 'loading' && 'rows' in openUsage && (
            <p className="asset-detail-line">
              {openUsage.rows.length === 0
                ? t('assets.usageNone')
                : t('assets.usageCount', { count: openUsage.rows.length })}
              {openUsage.rows.length > 0 && (
                <span className="mute">
                  {' — '}
                  {[...new Set(openUsage.rows.map((r) => r.fieldName))].join(', ')}
                </span>
              )}
            </p>
          )}
        </div>
      )}
      <div className="ledger-foot">{t('assets.foot', { count: assets.length })}</div>
    </Chrome>
  );
}

function extensionOf(asset: CmsAsset): string {
  const dot = asset.name.lastIndexOf('.');
  return dot > 0 ? asset.name.slice(dot + 1).toUpperCase().slice(0, 5) : '';
}
