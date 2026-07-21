'use client';

import { useCallback, useEffect, useState } from 'react';
import { Code, Copy, MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CreateTrackerBody } from '@getmunin/types';
import { api, ApiError } from '../api';
import { useTranslateError } from '../i18n/translate-error';
import { LoadFailed } from '../components/load-failed';
import { CardListSkeleton } from '../components/skeleton';
import { EmptyCallout } from '../components/empty-callout';
import { CopyableSecret } from '../components/copyable-secret';
import { useConfirm } from '../components/confirm-dialog';
import { FormField } from '../components/form-field';
import { SaveErrorStage, type SaveErrorDetail } from '../components/save-error-stage';
import { useLoadGate } from '../lib/use-load-gate';
import { useSettingsLoadFailedProps } from '../lib/use-load-failed-props';
import { notify } from '../lib/notify';
import { dialogButtonClass, dialogFooterClass, dialogHintClass, dialogLabelClass } from '../lib/dialog-style';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Hero,
  Input,
  Label,
  SectionHead,
  cn,
} from '@getmunin/ui';

interface TrackerSummary {
  id: string;
  name: string;
  allowedOrigins: string[];
  keyPrefix: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  requireVerifiedIdentity: boolean;
  hasIdentityVerificationSecret: boolean;
}

interface CreatedTracker extends TrackerSummary {
  trackerKey: string;
  identityVerificationSecret: string;
}

interface RotatedIdentity {
  trackerId: string;
  name: string;
  identityVerificationSecret: string;
}

interface RotatedKey {
  trackerId: string;
  name: string;
  trackerKey: string;
}

const KEY_DISPLAY_TIMEOUT_MS = 1500;

function toSaveErrorDetail(
  err: unknown,
  _message: string,
  fallback: { endpoint: string; method: string },
): SaveErrorDetail {
  if (err instanceof ApiError) {
    return {
      endpoint: err.endpoint,
      method: err.method,
      status: `${err.status} · ${err.statusText}`,
      requestId: err.requestId,
      message: err.status >= 400 && err.status < 500 ? err.message : undefined,
    };
  }
  return {
    endpoint: fallback.endpoint,
    method: fallback.method,
    status: '—',
    requestId: null,
  };
}

export function TrackersPage() {
  const t = useTranslations('dashboard.trackers');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const confirm = useConfirm();
  const [trackers, setTrackers] = useState<TrackerSummary[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [rotatedIdentity, setRotatedIdentity] = useState<RotatedIdentity | null>(null);
  const [rotatedKey, setRotatedKey] = useState<RotatedKey | null>(null);
  const [embedFor, setEmbedFor] = useState<TrackerSummary | null>(null);

  const load = useCallback(async () => {
    const res = await api<{ items: TrackerSummary[] }>('/v1/analytics/trackers');
    setTrackers(res.items);
  }, []);

  const { loadError, hasLoadedOnce, retrying, tryLoad, retry } = useLoadGate(load);
  const buildLoadFailedProps = useSettingsLoadFailedProps();

  useEffect(() => {
    void tryLoad();
  }, [tryLoad]);

  async function rotateKey(tracker: TrackerSummary) {
    const ok = await confirm({
      title: t('rotateKeyConfirmTitle'),
      message: t('rotateKeyConfirm', { name: tracker.name }),
      confirmLabel: t('rotateKey'),
      cancelLabel: tCommon('cancel'),
      destructive: true,
    });
    if (!ok) return;
    try {
      const result = await api<{ trackerKey: string }>(
        `/v1/analytics/trackers/${tracker.id}/rotate-key`,
        { method: 'POST' },
      );
      setRotatedKey({
        trackerId: tracker.id,
        name: tracker.name,
        trackerKey: result.trackerKey,
      });
      await tryLoad();
    } catch (err) {
      notify.error(translate(err) || t('errors.rotateKey'));
    }
  }

  async function rotateIdentity(tracker: TrackerSummary) {
    const ok = await confirm({
      title: t('rotateIdentityConfirmTitle'),
      message: t('rotateIdentityConfirm', { name: tracker.name }),
      confirmLabel: t('rotateIdentity'),
      cancelLabel: tCommon('cancel'),
      destructive: true,
    });
    if (!ok) return;
    try {
      const result = await api<{ identityVerificationSecret: string }>(
        `/v1/analytics/trackers/${tracker.id}/rotate-identity-secret`,
        { method: 'POST' },
      );
      setRotatedIdentity({
        trackerId: tracker.id,
        name: tracker.name,
        identityVerificationSecret: result.identityVerificationSecret,
      });
      await tryLoad();
    } catch (err) {
      notify.error(translate(err) || t('errors.rotate'));
    }
  }

  async function revoke(tracker: TrackerSummary) {
    const ok = await confirm({
      title: t('revokeConfirmTitle'),
      message: t('revokeConfirm', { name: tracker.name }),
      confirmLabel: t('revoke'),
      cancelLabel: tCommon('cancel'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await api(`/v1/analytics/trackers/${tracker.id}/revoke`, { method: 'POST' });
      await tryLoad();
      notify.success(t('revoked'));
    } catch (err) {
      notify.error(translate(err) || t('errors.revoke'));
    }
  }

  if (loadError && !hasLoadedOnce) {
    return (
      <LoadFailed
        {...buildLoadFailedProps('trackers', loadError, () => void retry(), retrying)}
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

      <CreateTrackerDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          void tryLoad();
        }}
      />

      {rotatedIdentity && (
        <RotatedIdentityDialog
          rotated={rotatedIdentity}
          onClose={() => setRotatedIdentity(null)}
        />
      )}

      {rotatedKey && (
        <RotatedKeyDialog rotated={rotatedKey} onClose={() => setRotatedKey(null)} />
      )}

      {embedFor && (
        <EmbedSnippetDialog tracker={embedFor} onClose={() => setEmbedFor(null)} />
      )}

      <section className="space-y-4">
        <SectionHead
          title={
            trackers
              ? t('trackersTitleCount', { count: trackers.length })
              : t('trackersTitle')
          }
          actions={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              {t('addTracker')}
            </Button>
          }
          divider={false}
        />

        {trackers === null ? (
          <CardListSkeleton rows={3} />
        ) : trackers.length === 0 ? (
          <EmptyCallout title={t('emptyTitle')} body={t('emptyBody')} />
        ) : (
          <ul className="space-y-3">
            {trackers.map((tr) => (
              <TrackerRow
                key={tr.id}
                tracker={tr}
                onShowEmbed={() => setEmbedFor(tr)}
                onRotateKey={() => {
                  void rotateKey(tr);
                }}
                onRotateIdentity={() => {
                  void rotateIdentity(tr);
                }}
                onRevoke={() => {
                  void revoke(tr);
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function TrackerRow({
  tracker,
  onShowEmbed,
  onRotateKey,
  onRotateIdentity,
  onRevoke,
}: {
  tracker: TrackerSummary;
  onShowEmbed: () => void;
  onRotateKey: () => void;
  onRotateIdentity: () => void;
  onRevoke: () => void;
}) {
  const t = useTranslations('dashboard.trackers');
  const origins = tracker.allowedOrigins;
  return (
    <li className="border-[1px] border-rule-soft dark:border-rule-on-dark bg-paper dark:bg-card px-5 py-4">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1 space-y-3">
          <h3 className="font-serif text-lg leading-none text-ink dark:text-foreground">
            {tracker.name}
          </h3>

          <div className="flex flex-wrap items-center gap-1.5">
            {origins.length > 0 ? (
              origins.map((o) => <OriginChip key={o} text={o} />)
            ) : (
              <OriginChip text={t('anyOrigin')} muted />
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button variant="outline" size="sm" onClick={onShowEmbed} className="gap-1.5">
            <Code className="size-3.5" />
            {t('showEmbed')}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={t('rotateKey')}
                />
              }
            >
              <MoreHorizontal className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onRotateKey}>
                {t('rotateKey')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onRotateIdentity}>
                {t('rotateIdentity')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={onRevoke}>
                {t('revoke')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </li>
  );
}

function OriginChip({ text, muted }: { text: string; muted?: boolean }) {
  return (
    <span
      className={cn(
        'inline-block border-[1px] border-rule-soft dark:border-rule-on-dark bg-paper-deep dark:bg-secondary px-2 py-0.5 font-mono text-[11px]',
        muted ? 'text-ink-mute italic' : 'text-ink dark:text-foreground',
      )}
    >
      {text}
    </span>
  );
}

function CreateTrackerDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const t = useTranslations('dashboard.trackers');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const [name, setName] = useState('');
  const [originAllowlist, setOriginAllowlist] = useState('');
  const [originsError, setOriginsError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedTracker | null>(null);
  const [submitError, setSubmitError] = useState<SaveErrorDetail | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setOriginAllowlist('');
      setOriginsError(null);
      setCreated(null);
      setSubmitError(null);
      setCreating(false);
    }
  }, [open]);

  async function submit() {
    if (!name.trim()) return;
    const allowlist = originAllowlist
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const parsed = CreateTrackerBody.safeParse({
      name: name.trim(),
      allowedOrigins: allowlist,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues.find(
        (i) => Array.isArray(i.path) && i.path[0] === 'allowedOrigins',
      );
      const badIndex = issue?.path[1];
      const badValue = typeof badIndex === 'number' ? allowlist[badIndex] : undefined;
      setOriginsError(t('originsInvalid', { invalid: badValue ?? allowlist.join(', ') }));
      return;
    }
    setOriginsError(null);
    setCreating(true);
    setSubmitError(null);
    try {
      const result = await api<CreatedTracker>('/v1/analytics/trackers', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      setCreated(result);
      onCreated();
    } catch (err) {
      setSubmitError(
        toSaveErrorDetail(err, translate(err) || t('errors.create'), {
          endpoint: '/v1/analytics/trackers',
          method: 'POST',
        }),
      );
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
              <DialogTitle>{t('createdTitle')}</DialogTitle>
              <DialogDescription>
                {t('createdDescription', { name: created.name })}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 mt-2">
              <CopyableSecret label={t('keyLabelTracker')} value={created.trackerKey} />
              <CopyableSecret
                label={t('keyLabelIdentitySecret')}
                value={created.identityVerificationSecret}
                hint={t('identitySecretHint')}
              />
            </div>
            <DialogFooter className={dialogFooterClass}>
              <Button
                variant="accent"
                className={dialogButtonClass}
                onClick={() => onOpenChange(false)}
              >
                {tCommon('gotIt')}
              </Button>
            </DialogFooter>
          </>
        ) : submitError ? (
          <SaveErrorStage
            detail={submitError}
            onBack={() => setSubmitError(null)}
            onRetry={() => void submit()}
            retrying={creating}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('createTitle')}</DialogTitle>
              <DialogDescription>{t('createDescription')}</DialogDescription>
            </DialogHeader>
            <form
              className="mt-4 flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <FormField label={t('nameLabel')} hint={t('nameHint')}>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('namePlaceholder')}
                  required
                  autoFocus
                />
              </FormField>
              <FormField label={t('originsLabel')} hint={t('originsHint')}>
                <Input
                  value={originAllowlist}
                  onChange={(e) => {
                    setOriginAllowlist(e.target.value);
                    if (originsError) setOriginsError(null);
                  }}
                  placeholder="https://example.com, https://www.example.com"
                  required={trackerAllowlistRequired()}
                  aria-invalid={originsError ? true : undefined}
                />
                {originsError && (
                  <p className="text-sm text-destructive" role="alert">
                    {originsError}
                  </p>
                )}
              </FormField>

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
                  {creating ? tCommon('creating') : t('createSubmit')}
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

function trackerAllowlistRequired(): boolean {
  const raw = process.env.NEXT_PUBLIC_TRACKER_REQUIRE_ALLOWLIST?.trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

function RotatedIdentityDialog({
  rotated,
  onClose,
}: {
  rotated: RotatedIdentity;
  onClose: () => void;
}) {
  const t = useTranslations('dashboard.trackers');
  const tCommon = useTranslations('common');
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('rotatedIdentityTitle')}</DialogTitle>
          <DialogDescription>
            {t('rotatedIdentityDescription', { name: rotated.name })}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2">
          <CopyableSecret
            label={t('keyLabelIdentitySecret')}
            value={rotated.identityVerificationSecret}
            hint={t('identitySecretHint')}
          />
        </div>
        <DialogFooter className={dialogFooterClass}>
          <Button variant="accent" className={dialogButtonClass} onClick={onClose}>
            {tCommon('gotIt')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RotatedKeyDialog({
  rotated,
  onClose,
}: {
  rotated: RotatedKey;
  onClose: () => void;
}) {
  const t = useTranslations('dashboard.trackers');
  const tCommon = useTranslations('common');
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('rotatedKeyTitle')}</DialogTitle>
          <DialogDescription>
            {t('rotatedKeyDescription', { name: rotated.name })}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2">
          <CopyableSecret label={t('keyLabelTracker')} value={rotated.trackerKey} />
        </div>
        <DialogFooter className={dialogFooterClass}>
          <Button variant="accent" className={dialogButtonClass} onClick={onClose}>
            {tCommon('gotIt')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const HASH_SNIPPETS: Array<{
  language: string;
  label: string;
  build: () => string;
}> = [
  {
    language: 'node',
    label: 'Node.js',
    build: () => `// Sign the visitor id (from window.mn.getVisitorId()) together with your user id.
import crypto from 'node:crypto';
const userHash = crypto
  .createHmac('sha256', process.env.MUNIN_TRACKER_IDENTITY_SECRET)
  .update(\`\${externalId}:\${visitorId}\`) // stable user id + window.mn.getVisitorId()
  .digest('hex');`,
  },
  {
    language: 'ruby',
    label: 'Ruby',
    build: () => `require 'openssl'
user_hash = OpenSSL::HMAC.hexdigest(
  'sha256', ENV['MUNIN_TRACKER_IDENTITY_SECRET'], "#{external_id}:#{visitor_id}"
)`,
  },
  {
    language: 'php',
    label: 'PHP',
    build: () => `$userHash = hash_hmac(
  'sha256',
  "$externalId:$visitorId",
  getenv('MUNIN_TRACKER_IDENTITY_SECRET')
);`,
  },
  {
    language: 'python',
    label: 'Python',
    build: () => `import hmac, hashlib, os
user_hash = hmac.new(
    os.environ['MUNIN_TRACKER_IDENTITY_SECRET'].encode(),
    f"{external_id}:{visitor_id}".encode(),
    hashlib.sha256,
).hexdigest()`,
  },
];

function EmbedSnippetDialog({
  tracker,
  onClose,
}: {
  tracker: TrackerSummary;
  onClose: () => void;
}) {
  const t = useTranslations('dashboard.trackers');
  const tCommon = useTranslations('common');
  const [language, setLanguage] = useState(HASH_SNIPPETS[0]!.language);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [hashCopied, setHashCopied] = useState(false);

  const host = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
  const scriptSnippet = [
    `<script async src="${host}/tracker.js" data-key="<your tracker key>"></script>`,
    ``,
    `<script>`,
    `  // On the first authenticated page load, link the visitor to your user:`,
    `  const go = () => {`,
    `    const visitorId = window.mn.getVisitorId();`,
    `    // POST { externalId, visitorId } to your server, get back userHash, then:`,
    `    window.mn.identify(externalId, userHash);`,
    `  };`,
    `  window.mn?.ready`,
    `    ? go()`,
    `    : document.addEventListener('munin:ready', go, { once: true });`,
    `</script>`,
  ].join('\n');

  const hashSnippet = HASH_SNIPPETS.find((s) => s.language === language)!.build();

  function copySnippet() {
    void navigator.clipboard.writeText(scriptSnippet).then(() => {
      setSnippetCopied(true);
      setTimeout(() => setSnippetCopied(false), KEY_DISPLAY_TIMEOUT_MS);
    });
  }
  function copyHash() {
    void navigator.clipboard.writeText(hashSnippet).then(() => {
      setHashCopied(true);
      setTimeout(() => setHashCopied(false), KEY_DISPLAY_TIMEOUT_MS);
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('embed.title', { name: tracker.name })}</DialogTitle>
          <DialogDescription>{t('embed.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-8 py-2">
          <div className="space-y-3">
            <Label className={dialogLabelClass}>{t('embed.scriptLabel')}</Label>
            <pre className="overflow-x-auto rounded-md border-[1px] bg-muted px-3 py-2 font-mono text-xs">
              {scriptSnippet}
            </pre>
            <Button variant="outline" size="sm" onClick={copySnippet}>
              <Copy className="size-4" />
              {snippetCopied ? tCommon('copied') : t('embed.copyScript')}
            </Button>
            <p className={dialogHintClass}>{t('embed.scriptHint')}</p>
          </div>

          <div className="space-y-3">
            <Label className={dialogLabelClass}>{t('embed.hashLabel')}</Label>
            <p className={dialogHintClass}>{t('embed.hashHint')}</p>
            <div className="flex w-fit border-[1px] border-ink dark:border-foreground">
              {HASH_SNIPPETS.map((s) => {
                const active = s.language === language;
                return (
                  <button
                    key={s.language}
                    type="button"
                    onClick={() => setLanguage(s.language)}
                    className={cn(
                      'w-24 h-7 px-2.5 font-mono text-[11px] uppercase tracking-eyebrow border-r-[1px] border-rule-soft last:border-r-0 transition-colors duration-fast ease-munin',
                      active
                        ? 'bg-ink text-paper dark:bg-foreground dark:text-background'
                        : 'bg-paper hover:bg-paper-deep dark:bg-card dark:hover:bg-secondary',
                    )}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
            <pre className="overflow-x-auto rounded-md border-[1px] bg-muted px-3 py-2 font-mono text-xs">
              {hashSnippet}
            </pre>
            <Button variant="outline" size="sm" onClick={copyHash}>
              <Copy className="size-4" />
              {hashCopied ? tCommon('copied') : t('embed.copyHash')}
            </Button>
          </div>
        </div>
        <DialogFooter className={dialogFooterClass}>
          <Button type="button" variant="accent" className={dialogButtonClass} onClick={onClose}>
            {tCommon('done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
