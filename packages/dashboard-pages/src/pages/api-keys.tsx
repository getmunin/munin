'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Copy } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { api } from '../api';
import { useTranslateError } from '../i18n/translate-error';
import { LoadFailed } from '../components/load-failed';
import { EmptyCallout } from '../components/empty-callout';
import { useLoadGate } from '../lib/use-load-gate';
import { useSettingsLoadFailedProps } from '../lib/use-load-failed-props';
import {
  dialogButtonClass,
  dialogFooterClass,
  dialogHintClass,
  dialogLabelClass,
} from '../lib/dialog-style';
import {
  Button,
  Card,
  CardContent,
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
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const format = useFormatter();
  const [keys, setKeys] = useState<ApiKeySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mintOpen, setMintOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const list = await api<ApiKeySummary[]>('/api/v1/api-keys');
    setKeys(list);
  }, []);

  const { loadError, hasLoadedOnce, retrying, tryLoad, retry } = useLoadGate(load);
  const buildLoadFailedProps = useSettingsLoadFailedProps();

  useEffect(() => {
    void tryLoad();
  }, [tryLoad]);

  async function revoke(id: string) {
    try {
      await api(`/api/v1/api-keys/${id}`, { method: 'DELETE' });
      await tryLoad();
    } catch (err) {
      setError(translate(err) || t('errors.revoke'));
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

      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

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
          <p className="text-sm text-ink-mute">{tCommon('loading')}</p>
        ) : keys.length === 0 ? (
          <EmptyCallout title={t('emptyTitle')} body={t('emptyBody')} />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-rule-soft dark:border-rule-on-dark text-left">
                <Th>{t('tableName')}</Th>
                <Th>{t('tablePrefix')}</Th>
                <Th>{t('tableCreated')}</Th>
                <Th>{t('tableLastUsed')}</Th>
                <Th className="text-right" />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-b border-rule-soft dark:border-rule-on-dark">
                  <td className="py-4 pr-4 text-sm font-medium text-ink dark:text-foreground">
                    {k.name}
                  </td>
                  <td className="py-4 pr-4 font-mono text-xs text-ink-mute">{k.prefix}…</td>
                  <td className="py-4 pr-4 font-mono text-xs text-ink-mute">
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
                    <Button variant="outline" size="sm" onClick={() => void revoke(k.id)}>
                      {tCommon('revoke')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'pb-3 pr-4 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute font-normal',
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
  const translate = useTranslateError();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setCreated(null);
      setError(null);
      setCreating(false);
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const result = await api<CreatedApiKey>('/api/v1/api-keys', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), scopes: ['*'] }),
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
              <KeyReveal value={created.key} copyLabel={t('copyClipboard')} />
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
                  disabled={creating}
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

function KeyReveal({ value, copyLabel }: { value: string; copyLabel: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 truncate border border-rule-soft dark:border-rule-on-dark bg-paper-deep dark:bg-secondary px-3 py-2 font-mono text-xs text-ink dark:text-foreground">
        {value}
      </code>
      <Button variant="outline" size="sm" onClick={copy} className="gap-1.5">
        <Copy className="size-3.5" />
        {copied ? '✓' : copyLabel}
      </Button>
    </div>
  );
}
