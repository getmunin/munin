'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DropdownMenuItem, SectionHead } from '@getmunin/ui';
import { api } from '../../api';
import { notify } from '../../lib/notify';
import { useTranslateError } from '../../i18n/translate-error';
import { useConfirm } from '../confirm-dialog';
import { CardSkeleton } from '../skeleton';
import { CardGrid, CardMenu, StatusLine } from '../card-kit';
import { IntegrationCard } from './integration-card';
import {
  ConnectConnectorDialog,
  type ConnectVendor,
  type CreatedConnection,
  type EditableConnection,
} from './connect-connector-dialog';
import { VendorFieldRow, type VendorField } from './vendor-field-row';
import { vendorPresentation } from './vendor-catalog';
import { ChooseToolsDialog } from './choose-tools-dialog';

type Vendor = ConnectVendor;

interface Connection {
  id: string;
  vendor: string;
  domain: string;
  name: string;
  active: boolean;
  credentialState: 'active' | 'pending' | 'expired' | 'revoked';
  needsAuthorization: boolean;
  lastTestError: string | null;
  settings?: { allowedTools?: string[] };
}

function supportsToolPicker(conn: Pick<Connection, 'domain' | 'credentialState'>): boolean {
  return conn.domain === 'mcp' && conn.credentialState === 'active';
}

function shortDetail(detail: string | undefined): string {
  const trimmed = (detail ?? '').trim();
  if (trimmed.length <= 120) return trimmed;
  return `${trimmed.slice(0, 117).trimEnd()}…`;
}

function exposesNoTools(conn: Connection): boolean {
  return supportsToolPicker(conn) && (conn.settings?.allowedTools?.length ?? 0) === 0;
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
  const [chooseToolsFor, setChooseToolsFor] = useState<Connection | null>(null);
  const [editConnection, setEditConnection] = useState<EditableConnection | null>(null);
  const [inSetupFlow, setInSetupFlow] = useState(false);
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

  async function authorize(conn: Connection) {
    setBusyId(conn.id);
    try {
      const { url } = await api<{ url: string }>(`/v1/connectors/${conn.id}/authorize-link`, {
        method: 'POST',
      });
      window.location.assign(url);
    } catch (err) {
      notify.error(translate(err));
      setBusyId(null);
    }
  }

  async function test(conn: Connection) {
    setBusyId(conn.id);
    try {
      const res = await api<{ ok: boolean; detail?: string; summary?: string; error?: string }>(
        `/v1/connectors/${conn.id}/test`,
        { method: 'POST' },
      );
      if (res.ok) notify.success(t('testOk', { detail: shortDetail(res.summary ?? res.detail) }));
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
        <SectionHead title={td('title')} subtitle={td('subtitle')} />
        <p className="text-sm text-destructive">{loadError}</p>
      </section>
    );
  }
  if (!connections) {
    return (
      <section className="space-y-4">
        <SectionHead title={td('title')} subtitle={td('subtitle')} />
        <CardSkeleton />
      </section>
    );
  }

  const connectedVendorIds = new Set(connections.map((c) => c.vendor));
  const availableVendors = vendors.filter((v) => !connectedVendorIds.has(v.vendor));
  const activeCount = connections.filter((c) => c.active && c.credentialState === 'active').length;

  function statusOf(conn: Connection): { tone: 'active' | 'pending' | 'error' | 'inactive'; label: string } {
    if (conn.credentialState === 'expired') return { tone: 'error', label: t('statusExpired') };
    if (conn.credentialState === 'revoked') return { tone: 'inactive', label: t('statusRevoked') };
    if (conn.credentialState === 'pending') return { tone: 'pending', label: t('statusPending') };
    if (conn.lastTestError) return { tone: 'error', label: t('statusError') };
    if (!conn.active) return { tone: 'inactive', label: t('statusInactive') };
    if (exposesNoTools(conn)) return { tone: 'pending', label: t('statusNoTools') };
    return { tone: 'active', label: t('statusActive') };
  }

  return (
    <section className="space-y-4">
      <SectionHead
        title={td('title')}
        subtitle={td('subtitle')}
        actions={t('connectedCount', { count: activeCount })}
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
              meta={<StatusLine tone={s.tone} label={s.label} />}
              description={tc(`description.${present.descriptionKey}`)}
              menu={
                <CardMenu label={t('moreMenu')} disabled={busyId === conn.id}>
                  {supportsToolPicker(conn) && (
                    <DropdownMenuItem
                      disabled={busyId === conn.id}
                      onClick={() => setChooseToolsFor(conn)}
                    >
                      {t('chooseTools')}
                    </DropdownMenuItem>
                  )}
                  {conn.needsAuthorization && secretFields(conn.vendor).length > 0 && (
                    <DropdownMenuItem
                      disabled={busyId === conn.id}
                      onClick={() => setEnterFor(conn)}
                    >
                      {t('enterCredentials')}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={busyId === conn.id}
                    onClick={() => void remove(conn)}
                  >
                    {t('delete')}
                  </DropdownMenuItem>
                </CardMenu>
              }
              footer={
                conn.needsAuthorization ? (
                  <Button type="button" variant="outline" size="sm" className="whitespace-nowrap" onClick={() => void authorize(conn)} disabled={busyId === conn.id}>
                    {conn.credentialState === 'expired' ? t('reconnect') : t('authorize')}
                  </Button>
                ) : conn.credentialState === 'pending' ? (
                  <Button type="button" variant="outline" size="sm" className="whitespace-nowrap" onClick={() => setEnterFor(conn)} disabled={busyId === conn.id}>
                    {t('enterCredentials')}
                  </Button>
                ) : exposesNoTools(conn) ? (
                  <Button type="button" variant="outline" size="sm" className="whitespace-nowrap" onClick={() => setChooseToolsFor(conn)} disabled={busyId === conn.id}>
                    {t('chooseTools')}
                  </Button>
                ) : (
                  <Button type="button" variant="outline" size="sm" className="whitespace-nowrap" onClick={() => void test(conn)} disabled={busyId === conn.id}>
                    {t('test')}
                  </Button>
                )
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
          existing={editConnection ?? undefined}
          onClose={() => {
            setConnectVendor(null);
            setEditConnection(null);
            setInSetupFlow(false);
          }}
          onDone={async (saved: CreatedConnection) => {
            const vendorName = connectVendor.vendor;
            setConnectVendor(null);
            setEditConnection(null);
            await refresh();
            if (supportsToolPicker(saved)) {
              setInSetupFlow(true);
              setChooseToolsFor({
                id: saved.id,
                name: saved.name,
                vendor: vendorName,
                domain: saved.domain,
                active: true,
                credentialState: saved.credentialState,
                needsAuthorization: false,
                lastTestError: null,
                settings: saved.settings as Connection['settings'],
              });
            } else {
              setInSetupFlow(false);
            }
          }}
        />
      )}
      {chooseToolsFor && (
        <ChooseToolsDialog
          connectionId={chooseToolsFor.id}
          connectionName={chooseToolsFor.name}
          onClose={() => {
            setChooseToolsFor(null);
            setInSetupFlow(false);
          }}
          onBack={
            inSetupFlow
              ? () => {
                  const current = chooseToolsFor;
                  const vendorMeta = vendors.find((v) => v.vendor === current.vendor);
                  setChooseToolsFor(null);
                  setInSetupFlow(false);
                  if (!vendorMeta) return;
                  setEditConnection({
                    id: current.id,
                    name: current.name,
                    settings: current.settings,
                  });
                  setConnectVendor(vendorMeta);
                }
              : undefined
          }
          onDone={async () => {
            setChooseToolsFor(null);
            setInSetupFlow(false);
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
            const completed = enterFor;
            setEnterFor(null);
            await refresh();
            if (completed && completed.domain === 'mcp') {
              setChooseToolsFor({ ...completed, credentialState: 'active' });
            }
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
  fields: VendorField[];
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
            <VendorFieldRow
              key={f.key}
              vendor={connection.vendor}
              field={f}
              value={values[f.key] ?? ''}
              onChange={(val) => setValues((v) => ({ ...v, [f.key]: val }))}
            />
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
