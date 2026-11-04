'use client';

import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { api } from '../api';
import { useTranslateError } from '../i18n/translate-error';
import { LoadFailed } from '../components/load-failed';
import { TableSkeleton } from '../components/skeleton';
import { EmptyCallout } from '../components/empty-callout';
import { useLoadGate } from '../lib/use-load-gate';
import { useSettingsLoadFailedProps } from '../lib/use-load-failed-props';
import { notify } from '../lib/notify';
import { CopyField } from '../components/copy-field';
import {
  dialogButtonClass,
  dialogFooterClass,
  dialogHintClass,
  dialogLabelClass,
} from '../lib/dialog-style';
import { CheckboxRow, RowGroup, RowGroupItem } from '../components/settings/scaffold';
import { CONSENT_MODULE_ORDER, groupConsentScopes } from '../auth/consent-scopes';
import { SUPPORTED_SCOPES } from '@getmunin/types';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Hero,
  Input,
  Label,
  SectionHead,
  cn,
} from '@getmunin/ui';

const ALL_SCOPES_VALUE = '*';

const MODULE_SCOPE_DEFS = CONSENT_MODULE_ORDER.map((module) => ({
  module,
  read: (SUPPORTED_SCOPES as readonly string[]).includes(`${module}:read`),
  write: (SUPPORTED_SCOPES as readonly string[]).includes(`${module}:write`),
})).filter((def) => def.read || def.write);

type ModuleScopeSelection = Record<string, { read: boolean; write: boolean }>;

interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

interface CreatedApiKey {
  id: string;
  name: string;
  key: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
}

export function ApiKeysPage() {
  const t = useTranslations('dashboard.apiKeys');
  const translate = useTranslateError();
  const format = useFormatter();
  const [keys, setKeys] = useState<ApiKeySummary[] | null>(null);
  const [mintOpen, setMintOpen] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const list = await api<ApiKeySummary[]>('/v1/api-keys');
    setKeys(list);
  }, []);

  const { loadError, hasLoadedOnce, retrying, tryLoad, retry } = useLoadGate(load);
  const buildLoadFailedProps = useSettingsLoadFailedProps();

  useEffect(() => {
    void tryLoad();
  }, [tryLoad]);

  async function revoke(id: string) {
    setRevokingId(id);
    try {
      await api(`/v1/api-keys/${id}`, { method: 'DELETE' });
      await tryLoad();
      notify.success(t('revoked'));
    } catch (err) {
      notify.error(translate(err) || t('errors.revoke'));
    } finally {
      setRevokingId(null);
    }
  }

  if (loadError && !hasLoadedOnce) {
    return (
      <LoadFailed
        {...buildLoadFailedProps('api-keys', loadError, () => void retry(), retrying)}
      />
    );
  }

  return (
    <>
      <Hero
        eyebrow={t('eyebrow')}
        title={t.rich('title', { em: (chunks) => <em>{chunks}</em> })}
        lede={t('subtitle')}
      />

      <section className="space-y-4">
        <SectionHead
          title={keys ? t('activeKeysTitleCount', { count: keys.length }) : t('activeKeysTitle')}
          actions={
            <Button size="sm" onClick={() => setMintOpen(true)}>
              {t('mintNew')}
            </Button>
          }
          divider={false}
        />

        {keys === null ? (
          <TableSkeleton
            columns={[
              { grow: 4, bar: 'w-2/3' },
              { grow: 2, bar: 'w-1/2' },
              { grow: 3, bar: 'w-3/4' },
              { grow: 2, bar: 'w-3/4' },
              { grow: 2, bar: 'w-3/4' },
              { grow: 1, bar: 'w-10', right: true },
            ]}
          />
        ) : keys.length === 0 ? (
          <EmptyCallout title={t('emptyTitle')} body={t('emptyBody')} />
        ) : (
          <div className="-mx-5 overflow-x-auto px-5 md:mx-0 md:px-0">
          <table className="w-full">
            <thead>
              <tr className="border-b-[1px] border-rule-soft dark:border-rule-on-dark text-left">
                <Th>{t('tableName')}</Th>
                <Th className="hidden md:table-cell">{t('tablePrefix')}</Th>
                <Th>{t('tableScopes')}</Th>
                <Th className="hidden md:table-cell">{t('tableCreated')}</Th>
                <Th>{t('tableLastUsed')}</Th>
                <Th className="text-right" />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-b-[1px] border-rule-soft dark:border-rule-on-dark">
                  <td className="py-4 pr-4 text-sm font-medium text-ink dark:text-foreground">
                    {k.name}
                  </td>
                  <td className="hidden md:table-cell py-4 pr-4 font-mono text-xs text-ink-mute">{k.prefix}…</td>
                  <td className="py-4 pr-4 text-xs text-ink-mute">
                    <ScopeSummary scopes={k.scopes} />
                  </td>
                  <td className="hidden md:table-cell py-4 pr-4 font-mono text-xs text-ink-mute">
                    {format.dateTime(new Date(k.createdAt), {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="py-4 pr-4 font-mono text-xs text-ink-mute">
                    {k.lastUsedAt
                      ? format.dateTime(new Date(k.lastUsedAt), {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : '—'}
                  </td>
                  <td className="py-4 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      pending={revokingId === k.id}
                      onClick={() => void revoke(k.id)}
                    >
                      {t('revoke')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>

      <MintKeyDialog
        open={mintOpen}
        onOpenChange={setMintOpen}
        onMinted={() => {
          void tryLoad();
        }}
      />
    </>
  );
}

function ScopeSummary({ scopes }: { scopes: string[] }) {
  const t = useTranslations('dashboard.apiKeys');
  const tModules = useTranslations('dashboard.oauthConsent.modules');
  if (scopes.includes(ALL_SCOPES_VALUE)) return <>{t('scopeFullAccess')}</>;
  const groups = groupConsentScopes(scopes).filter((g) => g.described);
  if (groups.length === 0) return <>{t('scopeNone')}</>;
  return (
    <>
      {groups
        .map(
          (g) =>
            `${tModules(g.module)} (${
              g.read && g.write ? t('scopeReadWrite') : g.write ? t('scopeWrite') : t('scopeRead')
            })`,
        )
        .join(', ')}
    </>
  );
}

function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'pb-3 pr-4 font-mono text-[10px] uppercase tracking-eyebrow text-ink-label font-medium',
        className,
      )}
    >
      {children}
    </th>
  );
}

function MintKeyDialog({
  open,
  onOpenChange,
  onMinted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMinted: () => void;
}) {
  const t = useTranslations('dashboard.apiKeys');
  const tCommon = useTranslations('common');
  const tModules = useTranslations('dashboard.oauthConsent.modules');
  const tModuleDescriptions = useTranslations('dashboard.oauthConsent.moduleDescriptions');
  const tActions = useTranslations('dashboard.oauthConsent.actions');
  const translate = useTranslateError();
  const [name, setName] = useState('');
  const [fullAccess, setFullAccess] = useState(true);
  const [moduleScopes, setModuleScopes] = useState<ModuleScopeSelection>({});
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setFullAccess(true);
      setModuleScopes({});
      setCreated(null);
      setError(null);
      setCreating(false);
    }
  }, [open]);

  const scopes = fullAccess
    ? [ALL_SCOPES_VALUE]
    : MODULE_SCOPE_DEFS.flatMap(({ module, read, write }) => {
        const selection = moduleScopes[module];
        const out: string[] = [];
        if (read && selection?.read) out.push(`${module}:read`);
        if (write && selection?.write) out.push(`${module}:write`);
        return out;
      });

  function toggleModuleScope(module: string, action: 'read' | 'write') {
    setModuleScopes((prev) => {
      const current = prev[module] ?? { read: false, write: false };
      return { ...prev, [module]: { ...current, [action]: !current[action] } };
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || scopes.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const result = await api<CreatedApiKey>('/v1/api-keys', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), scopes }),
      });
      setCreated(result);
      onMinted();
    } catch (err) {
      setError(translate(err) || t('errors.create'));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('revealTitle')}</DialogTitle>
              <DialogDescription>{t('revealSub')}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 mt-2">
              <p className="text-sm text-ink dark:text-foreground border-l-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
                {t('revealWarning')}
              </p>
              <KeyReveal value={created.key} />
            </div>
            <DialogFooter className={dialogFooterClass}>
              <Button
                variant="accent"
                className={dialogButtonClass}
                onClick={() => onOpenChange(false)}
              >
                {t('revealDone')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('mintModalTitle')}</DialogTitle>
              <DialogDescription>{t('mintModalSub')}</DialogDescription>
            </DialogHeader>
            <form className="flex flex-col gap-4 mt-2" onSubmit={(e) => void submit(e)}>
              <div className="space-y-2">
                <Label htmlFor="mint-name" className={dialogLabelClass}>
                  {t('nameLabel')}
                </Label>
                <Input
                  id="mint-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('namePlaceholder')}
                  required
                  autoFocus
                />
                <p className={dialogHintClass}>{t('nameHint')}</p>
              </div>

              <div className="space-y-2">
                <CheckboxRow
                  checked={fullAccess}
                  onChange={() => setFullAccess((v) => !v)}
                  title={t('fullAccessTitle')}
                  description={t('fullAccessDescription')}
                />
              </div>

              {!fullAccess && (
                <div className="space-y-2">
                  <Label className={dialogLabelClass}>{t('scopesLabel')}</Label>
                  <div className="max-h-64 overflow-y-auto border-[1px] border-rule-soft px-3 dark:border-rule-on-dark">
                    <RowGroup>
                      {MODULE_SCOPE_DEFS.map((def) => {
                        const selection = moduleScopes[def.module] ?? { read: false, write: false };
                        return (
                          <RowGroupItem key={def.module}>
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <div className="text-[13.5px] text-ink dark:text-foreground">
                                  {tModules(def.module)}
                                </div>
                                <div className="mt-0.5 text-[11.5px] leading-[1.4] text-ink-mute">
                                  {tModuleDescriptions(`${def.module}.${def.write ? 'readWrite' : 'read'}`)}
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-3 pt-0.5">
                                {def.read && (
                                  <ScopeCheckbox
                                    label={tActions('read')}
                                    checked={selection.read}
                                    onChange={() => toggleModuleScope(def.module, 'read')}
                                  />
                                )}
                                {def.write && (
                                  <ScopeCheckbox
                                    label={tActions('write')}
                                    checked={selection.write}
                                    onChange={() => toggleModuleScope(def.module, 'write')}
                                  />
                                )}
                              </div>
                            </div>
                          </RowGroupItem>
                        );
                      })}
                    </RowGroup>
                  </div>
                  {scopes.length === 0 && (
                    <p className={dialogHintClass}>{t('scopesEmptyHint')}</p>
                  )}
                </div>
              )}

              {error && (
                <p className={cn(dialogHintClass, 'text-destructive')} role="alert">
                  {error}
                </p>
              )}

              <DialogFooter className={dialogFooterClass}>
                <Button
                  type="button"
                  variant="outline"
                  className={dialogButtonClass}
                  onClick={() => onOpenChange(false)}
                >
                  {tCommon('cancel')}
                </Button>
                <Button
                  type="submit"
                  variant="accent"
                  className={dialogButtonClass}
                  disabled={creating || scopes.length === 0}
                >
                  {creating ? tCommon('creating') : t('mintModalSubmit')}
                  <span aria-hidden className="ml-1 font-mono">↵</span>
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function KeyReveal({ value }: { value: string }) {
  return <CopyField value={value} />;
}

function ScopeCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-soft dark:text-foreground/80">
      <Checkbox id={id} checked={checked} onCheckedChange={onChange} />
      {label}
    </label>
  );
}
