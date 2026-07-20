'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@getmunin/ui';
import { api } from '../../api';
import { notify } from '../../lib/notify';
import { useTranslateError } from '../../i18n/translate-error';
import { useConfirm } from '../confirm-dialog';
import { CardSkeleton } from '../skeleton';

interface VendorField {
  key: string;
  label: string;
  required: boolean;
  secret?: boolean;
  placeholder?: string;
}

interface Vendor {
  vendor: string;
  domain: string;
  displayName: string;
  configFields: VendorField[];
}

interface Connection {
  id: string;
  vendor: string;
  domain: string;
  name: string;
  active: boolean;
  credentialState: 'active' | 'pending';
  settings: Record<string, unknown>;
  lastTestError: string | null;
}

export function ConnectorsCard() {
  const t = useTranslations('integrations.connectors');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const confirm = useConfirm();

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [{ vendors: v }, { connections: c }] = await Promise.all([
        api<{ vendors: Vendor[] }>('/v1/connectors/vendors'),
        api<{ connections: Connection[] }>('/v1/connectors'),
      ]);
      setVendors(v);
      setConnections(c);
      setLoadError(null);
    } catch (err) {
      setLoadError(translate(err));
    }
  }, [translate]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function test(conn: Connection) {
    setBusyId(conn.id);
    try {
      const res = await api<{ ok: boolean; detail?: string; error?: string }>(
        `/v1/connectors/${conn.id}/test`,
        { method: 'POST' },
      );
      if (res.ok) notify.success(t('testOk', { detail: res.detail ?? '' }));
      else notify.error(t('testFailed', { error: res.error ?? '' }));
      await refresh();
    } catch (err) {
      notify.error(translate(err));
    } finally {
      setBusyId(null);
    }
  }

  async function copyLink(conn: Connection) {
    setBusyId(conn.id);
    try {
      const { url } = await api<{ url: string; expiresAt: string }>(
        `/v1/connectors/${conn.id}/credential-link`,
        { method: 'POST' },
      );
      await navigator.clipboard.writeText(url);
      notify.success(t('linkCopied'));
    } catch (err) {
      notify.error(translate(err));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(conn: Connection) {
    const ok = await confirm({
      title: t('deleteTitle'),
      message: t('deleteConfirm', { name: conn.name }),
      confirmLabel: t('delete'),
      cancelLabel: tCommon('cancel'),
      destructive: true,
    });
    if (!ok) return;
    setBusyId(conn.id);
    try {
      await api(`/v1/connectors/${conn.id}`, { method: 'DELETE' });
      await refresh();
    } catch (err) {
      notify.error(translate(err));
    } finally {
      setBusyId(null);
    }
  }

  if (loadError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">{loadError}</p>
        </CardContent>
      </Card>
    );
  }

  if (!connections) return <CardSkeleton />;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>{t('title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('lede')}</p>
        </div>
        <Button type="button" onClick={() => setAdding(true)} disabled={vendors.length === 0}>
          {t('add')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {connections.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          connections.map((conn) => (
            <div
              key={conn.id}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{conn.name}</span>
                  <StatusBadge conn={conn} t={t} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {conn.vendor} · {conn.domain}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {conn.credentialState === 'pending' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void copyLink(conn)}
                    disabled={busyId === conn.id}
                  >
                    {t('copyLink')}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void test(conn)}
                    disabled={busyId === conn.id}
                  >
                    {t('test')}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void remove(conn)}
                  disabled={busyId === conn.id}
                >
                  {t('delete')}
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
      {adding && (
        <AddConnectorDialog
          vendors={vendors}
          onClose={() => setAdding(false)}
          onDone={async () => {
            setAdding(false);
            await refresh();
          }}
        />
      )}
    </Card>
  );
}

function StatusBadge({
  conn,
  t,
}: {
  conn: Connection;
  t: ReturnType<typeof useTranslations>;
}) {
  if (conn.credentialState === 'pending') {
    return <Badge variant="secondary">{t('statusPending')}</Badge>;
  }
  if (conn.lastTestError) {
    return <Badge variant="destructive">{t('statusError')}</Badge>;
  }
  if (!conn.active) {
    return <Badge variant="outline">{t('statusInactive')}</Badge>;
  }
  return <Badge>{t('statusActive')}</Badge>;
}

function AddConnectorDialog({
  vendors,
  onClose,
  onDone,
}: {
  vendors: Vendor[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const t = useTranslations('integrations.connectors');
  const translate = useTranslateError();
  const [vendor, setVendor] = useState(vendors[0]?.vendor ?? '');
  const [name, setName] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const selected = vendors.find((v) => v.vendor === vendor);
  const nonSecret = selected?.configFields.filter((f) => !f.secret) ?? [];
  const secret = selected?.configFields.filter((f) => f.secret) ?? [];

  async function submit(includeSecrets: boolean) {
    if (!selected) return;
    setBusy(true);
    try {
      const config: Record<string, string> = {};
      for (const f of nonSecret) if (values[f.key]) config[f.key] = values[f.key]!;
      if (includeSecrets) for (const f of secret) if (values[f.key]) config[f.key] = values[f.key]!;
      const created = await api<{ credentialLink?: { url: string } }>('/v1/connectors', {
        method: 'POST',
        body: JSON.stringify({ vendor, name, config }),
      });
      if (created.credentialLink) {
        await navigator.clipboard.writeText(created.credentialLink.url).catch(() => {});
        notify.success(t('createdPending'));
      } else {
        notify.success(t('created'));
      }
      await onDone();
    } catch (err) {
      notify.error(translate(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('add')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t('vendor')}</Label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={vendor}
              onChange={(e) => {
                setVendor(e.target.value);
                setValues({});
              }}
            >
              {vendors.map((v) => (
                <option key={v.vendor} value={v.vendor}>
                  {v.displayName} ({v.domain})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>{t('name')}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('namePlaceholder')} />
          </div>
          {nonSecret.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label>{f.label}</Label>
              <Input
                value={values[f.key] ?? ''}
                placeholder={f.placeholder}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            </div>
          ))}
          {secret.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label>{f.label}</Label>
              <Input
                type="password"
                value={values[f.key] ?? ''}
                placeholder={f.placeholder}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">{t('handoffHint')}</p>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={() => void submit(false)}
            disabled={busy || !name || !vendor}
          >
            {t('createPending')}
          </Button>
          <Button type="button" onClick={() => void submit(true)} disabled={busy || !name || !vendor}>
            {t('create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
