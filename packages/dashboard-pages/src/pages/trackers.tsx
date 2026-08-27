'use client';

import { useCallback, useEffect, useState } from 'react';
import { Code, Copy } from 'lucide-react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { stripTrailingSlashes, CreateTrackerBody } from '@getmunin/types';
import { api } from '../api';
import { useTranslateError } from '../i18n/translate-error';
import { LoadFailed } from '../components/load-failed';
import { CardGridSkeleton } from '../components/skeleton';
import { EmptyCallout } from '../components/empty-callout';
import { CopyableSecret } from '../components/copyable-secret';
import { useConfirm } from '../components/confirm-dialog';
import { FormField } from '../components/form-field';
import { FormError, toFormError, type FormErrorDetail } from '../components/form-error';
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
  DropdownMenuItem,
  DropdownMenuSeparator,
  Hero,
  Input,
  Label,
  SectionHead,
  cn,
} from '@getmunin/ui';
import { CardGrid, CardMenu, SettingsCard, StatusLine } from '../components/card-kit';
import { Sparkline } from '../components/sparkline';

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

interface TrackerViewSummary {
  totalViews: number;
  points: Array<{ day: string; views: number }>;
}

type TrackerViewSummaries = Record<string, TrackerViewSummary>;

const KEY_DISPLAY_TIMEOUT_MS = 1500;

export function TrackersPage() {
  const t = useTranslations('dashboard.trackers');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const confirm = useConfirm();
  const [trackers, setTrackers] = useState<TrackerSummary[] | null>(null);
  const [viewsSummary, setViewsSummary] = useState<TrackerViewSummaries>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [rotatedIdentity, setRotatedIdentity] = useState<RotatedIdentity | null>(null);
  const [rotatedKey, setRotatedKey] = useState<RotatedKey | null>(null);
  const [embedFor, setEmbedFor] = useState<TrackerSummary | null>(null);

  const load = useCallback(async () => {
    const [res, summary] = await Promise.all([
      api<{ items: TrackerSummary[] }>('/v1/analytics/trackers'),
      api<TrackerViewSummaries>('/v1/analytics/trackers/views-summary').catch(() => ({})),
    ]);
    setTrackers(res.items);
    setViewsSummary(summary);
  }, []);

  const { loadError, hasLoadedOnce, retrying, tryLoad, retry } = useLoadGate(load);
  const buildLoadFailedProps = useSettingsLoadFailedProps();
  const neverFiredCount = trackers?.filter((tr) => !tr.lastUsedAt).length ?? 0;

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
          meta={
            neverFiredCount > 0 ? t('neverFiredCount', { count: neverFiredCount }) : undefined
          }
          actions={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              {t('addTracker')}
            </Button>
          }
          divider={false}
        />

        {trackers === null ? (
          <CardGridSkeleton count={3} />
        ) : trackers.length === 0 ? (
          <EmptyCallout title={t('emptyTitle')} body={t('emptyBody')} />
        ) : (
          <CardGrid>
            {trackers.map((tr) => (
              <TrackerRow
                key={tr.id}
                tracker={tr}
                viewSummary={viewsSummary[tr.id] ?? null}
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
          </CardGrid>
        )}
      </section>
    </>
  );
}

function TrackerRow({
  tracker,
  viewSummary,
  onShowEmbed,
  onRotateKey,
  onRotateIdentity,
  onRevoke,
}: {
  tracker: TrackerSummary;
  viewSummary: TrackerViewSummary | null;
  onShowEmbed: () => void;
  onRotateKey: () => void;
  onRotateIdentity: () => void;
  onRevoke: () => void;
}) {
  const t = useTranslations('dashboard.trackers');
  const format = useFormatter();
  const now = useNow();
  const origins = tracker.allowedOrigins;
  const qualifier = origins.length > 0 ? origins[0] : t('anyOrigin');
  const hasFired = tracker.lastUsedAt !== null;
  const status = hasFired ? (
    <StatusLine
      tone="active"
      label={t('status.receiving', {
        time: format.relativeTime(new Date(tracker.lastUsedAt!), now),
      })}
    />
  ) : (
    <StatusLine tone="pending" label={t('status.neverFired')} />
  );
  const totalViews = viewSummary?.totalViews ?? 0;
  const points = viewSummary?.points ?? [];

  return (
    <SettingsCard
      kind={t('kindWebsite')}
      name={tracker.name}
      qualifier={qualifier}
      status={status}
      accent={hasFired ? undefined : 'pending'}
      footerAction={
        <Button variant="outline" size="sm" onClick={onShowEmbed} className="gap-1.5">
          <Code className="size-3.5" />
          {hasFired ? t('showEmbed') : t('install')}
        </Button>
      }
      menu={
        <CardMenu label={t('moreActions')}>
          <DropdownMenuItem onClick={onRotateKey}>{t('rotateKey')}</DropdownMenuItem>
          <DropdownMenuItem onClick={onRotateIdentity}>{t('rotateIdentity')}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onClick={onRevoke}>
            {t('revoke')}
          </DropdownMenuItem>
        </CardMenu>
      }
    >
      <div className="flex items-baseline gap-1.5">
        <span className="font-serif text-[26px] leading-none tracking-tight text-ink dark:text-foreground">
          {totalViews.toLocaleString()}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute">
          {t('viewsLabel')}
        </span>
      </div>
      <div className="mt-2">
        <Sparkline points={points} />
      </div>
    </SettingsCard>
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
  const [submitError, setSubmitError] = useState<FormErrorDetail | null>(null);

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
      setSubmitError(toFormError(err, translate(err) || t('errors.create')));
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
              {submitError && <FormError detail={submitError} />}

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

  const host = stripTrailingSlashes(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001');
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
