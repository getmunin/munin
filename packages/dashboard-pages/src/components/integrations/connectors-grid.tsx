'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label } from '@getmunin/ui';
import { api } from '../../api';
import { notify } from '../../lib/notify';
import { useTranslateError } from '../../i18n/translate-error';
import { useConfirm } from '../confirm-dialog';
import { CardSkeleton } from '../skeleton';
import { CardGrid, IntegrationCard, SectionHeading, StatusPill } from './integration-card';
import { ConnectConnectorDialog, type ConnectVendor } from './connect-connector-dialog';
import { vendorPresentation } from './vendor-catalog';

type Vendor = ConnectVendor;

interface Connection {
  id: string;
  vendor: string;
  domain: string;
  name: string;
  active: boolean;
  credentialState: 'active' | 'pending';
  lastTestError: string | null;
}

export function DataConnectionsSection() {
  const t = useTranslations('integrations.connectors');
  const tc = useTranslations('integrations.catalog');
  const td = useTranslations('integrations.dataConnectors');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const confirm = useConfirm();

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connectVendor, setConnectVendor] = useState<Vendor | null>(null);
  const [enterFor, setEnterFor] = useState<Connection | null>(null);
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

  function secretFields(vendor: string) {
    return vendors.find((v) => v.vendor === vendor)?.configFields.filter((f) => f.secret) ?? [];
  }

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
      <section className="space-y-4">
        <SectionHeading title={td('title')} subtitle={td('subtitle')} />
        <p className="text-sm text-destructive">{loadError}</p>
      </section>
    );
  }
  if (!connections) {
    return (
      <section className="space-y-4">
        <SectionHeading title={td('title')} subtitle={td('subtitle')} />
        <CardSkeleton />
      </section>
    );
  }

  const connectedVendorIds = new Set(connections.map((c) => c.vendor));
  const availableVendors = vendors.filter((v) => !connectedVendorIds.has(v.vendor));
  const activeCount = connections.filter((c) => c.active && c.credentialState === 'active').length;

  function statusOf(conn: Connection): { tone: 'active' | 'pending' | 'error' | 'inactive'; label: string } {
    if (conn.credentialState === 'pending') return { tone: 'pending', label: t('statusPending') };
    if (conn.lastTestError) return { tone: 'error', label: t('statusError') };
    if (!conn.active) return { tone: 'inactive', label: t('statusInactive') };
    return { tone: 'active', label: t('statusActive') };
  }

  return (
    <section className="space-y-4">
      <SectionHeading
        title={td('title')}
        subtitle={td('subtitle')}
        countLabel={t('connectedCount', { count: activeCount })}
      />
      <CardGrid>
        {connections.map((conn) => {
          const present = vendorPresentation(conn.vendor, conn.domain);
          const s = statusOf(conn);
          const displayName = vendors.find((v) => v.vendor === conn.vendor)?.displayName ?? conn.vendor;
          return (
            <IntegrationCard
              key={conn.id}
              vendor={conn.vendor}
              name={displayName}
              instance={conn.name}
              category={tc(`category.${present.categoryKey}`)}
              description={tc(`description.${present.descriptionKey}`)}
              footer={
                <>
                  <StatusPill tone={s.tone} label={s.label} />
                  <div className="flex gap-1.5">
                    {conn.credentialState === 'pending' ? (
                      <Button type="button" variant="outline" size="sm" className="whitespace-nowrap" onClick={() => setEnterFor(conn)} disabled={busyId === conn.id}>
                        {t('enterCredentials')}
                      </Button>
                    ) : (
                      <Button type="button" variant="outline" size="sm" className="whitespace-nowrap" onClick={() => void test(conn)} disabled={busyId === conn.id}>
                        {t('test')}
                      </Button>
                    )}
                    <Button type="button" variant="ghost" size="sm" className="whitespace-nowrap" onClick={() => void remove(conn)} disabled={busyId === conn.id}>
                      {t('delete')}
                    </Button>
                  </div>
                </>
              }
            />
          );
        })}
        {availableVendors.map((v) => {
          const present = vendorPresentation(v.vendor, v.domain);
          return (
            <IntegrationCard
              key={v.vendor}
              vendor={v.vendor}
              name={v.displayName}
              category={tc(`category.${present.categoryKey}`)}
              description={tc(`description.${present.descriptionKey}`)}
              footer={
                <Button type="button" variant="outline" size="sm" className="whitespace-nowrap" onClick={() => setConnectVendor(v)}>
                  {t('connect')}
                </Button>
              }
            />
          );
        })}
      </CardGrid>

      {connectVendor && (
        <ConnectConnectorDialog
          vendor={connectVendor}
          onClose={() => setConnectVendor(null)}
          onDone={async () => {
            setConnectVendor(null);
            await refresh();
          }}
        />
      )}
      {enterFor && (
        <EnterCredentialsDialog
          connection={enterFor}
          fields={secretFields(enterFor.vendor)}
          onClose={() => setEnterFor(null)}
          onDone={async () => {
            setEnterFor(null);
            await refresh();
          }}
        />
      )}
    </section>
  );
}

function EnterCredentialsDialog({
  connection,
  fields,
  onClose,
  onDone,
}: {
  connection: Connection;
  fields: Array<{ key: string; label: string; required: boolean; placeholder?: string }>;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const t = useTranslations('integrations.connectors');
  const translate = useTranslateError();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const missingRequired = fields.some((f) => f.required && !values[f.key]);

  async function submit() {
    setBusy(true);
    try {
      const secrets: Record<string, string> = {};
      for (const f of fields) if (values[f.key]) secrets[f.key] = values[f.key]!;
      const res = await api<{ ok: boolean; detail?: string; error?: string }>(
        `/v1/connectors/${connection.id}/credentials`,
        { method: 'POST', body: JSON.stringify({ secrets }) },
      );
      if (res.ok) notify.success(t('testOk', { detail: res.detail ?? '' }));
      else notify.info(t('savedUntested', { error: res.error ?? '' }));
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
          <DialogTitle>{t('enterCredentialsFor', { name: connection.name })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {fields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label>{f.label}</Label>
              <Input
                type="password"
                autoComplete="off"
                value={values[f.key] ?? ''}
                placeholder={f.placeholder}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" onClick={() => void submit()} disabled={busy || missingRequired}>
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
