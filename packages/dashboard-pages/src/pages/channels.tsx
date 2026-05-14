'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ChevronDown,
  Code,
  Copy,
  KeyRound,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Send,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { api, ApiError } from '../api';
import { authClient } from '../auth-client';
import { useTranslateError } from '../i18n/translate-error';
import { LoadFailed } from '../components/load-failed';
import { EmptyCallout } from '../components/empty-callout';
import { SaveErrorStage, type SaveErrorDetail } from '../components/save-error-stage';
import { useConfirm } from '../components/confirm-dialog';
import { FormField } from '../components/form-field';
import { useLoadGate } from '../lib/use-load-gate';
import { useSettingsLoadFailedProps } from '../lib/use-load-failed-props';
import { notify } from '../lib/notify';
import { CreateWidgetBody, SetupEmailBody } from '@getmunin/types';
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

interface ChannelDto {
  id: string;
  type: 'email' | 'voice' | 'chat' | 'sms';
  name: string;
  active: boolean;
  config: Record<string, unknown>;
  createdAt: string;
}

interface EmailChannelDto extends ChannelDto {
  type: 'email';
  config: {
    addressing?: { fromAddress?: string; fromName?: string; replyToTemplate?: string };
    outbound?: {
      provider: 'smtp';
      host: string;
      port: number;
      secure?: boolean;
      username?: string;
      trackOpens?: boolean;
    };
    inbound?: {
      provider: 'imap';
      host: string;
      port: number;
      secure?: boolean;
      username?: string;
      mailbox?: string;
    };
    sendLimits?: { perDayMax?: number; perHourMax?: number };
  };
}

interface CreatedWidget {
  id: string;
  name: string;
  widgetKey: string;
  identityVerificationSecret?: string;
}

interface RotatedIdentity {
  id: string;
  name: string;
  identityVerificationSecret: string;
}

const KEY_DISPLAY_TIMEOUT_MS = 1500;

export function ChannelsPage() {
  const t = useTranslations('dashboard.channels');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const confirm = useConfirm();
  const [channels, setChannels] = useState<ChannelDto[] | null>(null);
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [editEmail, setEditEmail] = useState<EmailChannelDto | null>(null);
  const [rotated, setRotated] = useState<CreatedWidget | null>(null);
  const [rotatedIdentity, setRotatedIdentity] = useState<RotatedIdentity | null>(null);
  const [embedFor, setEmbedFor] = useState<ChannelDto | null>(null);
  const [sendTestFor, setSendTestFor] = useState<EmailChannelDto | null>(null);

  const load = useCallback(async () => {
    const list = await api<{ items: ChannelDto[] }>('/api/v1/conversations/channels');
    setChannels(list.items);
  }, []);

  const { loadError, hasLoadedOnce, retrying, tryLoad, retry } = useLoadGate(load);
  const buildLoadFailedProps = useSettingsLoadFailedProps();

  useEffect(() => {
    void tryLoad();
  }, [tryLoad]);

  async function rotateKey(channel: ChannelDto) {
    const ok = await confirm({
      title: t('rotateConfirmTitle'),
      message: t('rotateConfirm', { name: channel.name }),
      confirmLabel: t('rotateKey'),
      cancelLabel: tCommon('cancel'),
    });
    if (!ok) return;
    try {
      const result = await api<{ widgetKey: string }>(
        `/api/v1/conversations/channels/widget/${channel.id}/rotate-key`,
        { method: 'POST' },
      );
      setRotated({ id: channel.id, name: channel.name, widgetKey: result.widgetKey });
    } catch (err) {
      notify.error(translate(err) || t('errors.rotate'));
    }
  }

  async function rotateIdentity(channel: ChannelDto) {
    const ok = await confirm({
      title: t('rotateIdentityConfirmTitle'),
      message: t('rotateIdentityConfirm', { name: channel.name }),
      confirmLabel: t('rotateIdentity'),
      cancelLabel: tCommon('cancel'),
    });
    if (!ok) return;
    try {
      const result = await api<{ identityVerificationSecret: string }>(
        `/api/v1/conversations/channels/widget/${channel.id}/rotate-identity-secret`,
        { method: 'POST' },
      );
      setRotatedIdentity({
        id: channel.id,
        name: channel.name,
        identityVerificationSecret: result.identityVerificationSecret,
      });
    } catch (err) {
      notify.error(translate(err) || t('errors.rotateIdentity'));
    }
  }

  async function deleteChannel(channel: ChannelDto) {
    const ok = await confirm({
      title: t('deleteChannelConfirmTitle'),
      message: t('deleteChannelConfirm', { name: channel.name }),
      confirmLabel: t('deleteChannel'),
      cancelLabel: tCommon('cancel'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await api(`/api/v1/conversations/channels/${channel.id}`, { method: 'DELETE' });
      await tryLoad();
    } catch (err) {
      notify.error(translate(err) || t('errors.delete'));
    }
  }

  if (loadError && !hasLoadedOnce) {
    return (
      <LoadFailed
        {...buildLoadFailedProps('channels', loadError, () => void retry(), retrying)}
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

      <CreateWidgetDialog
        open={widgetOpen}
        onOpenChange={setWidgetOpen}
        onCreated={() => {
          void tryLoad();
        }}
      />

      <EmailChannelDialog
        open={emailOpen || editEmail !== null}
        editChannel={editEmail}
        onOpenChange={(next) => {
          if (!next) {
            setEmailOpen(false);
            setEditEmail(null);
          }
        }}
        onSaved={() => {
          void tryLoad();
        }}
      />

      <RotatedSecretDialog
        open={rotated !== null}
        title={t('rotatedTitle')}
        description={rotated ? t('rotatedDescription', { name: rotated.name }) : ''}
        rows={
          rotated
            ? [{ label: t('keyLabelWidget'), value: rotated.widgetKey }]
            : []
        }
        onClose={() => setRotated(null)}
      />

      <RotatedSecretDialog
        open={rotatedIdentity !== null}
        title={t('rotatedIdentityTitle')}
        description={
          rotatedIdentity ? t('rotatedIdentityDescription', { name: rotatedIdentity.name }) : ''
        }
        rows={
          rotatedIdentity
            ? [
                {
                  label: t('keyLabelIdentitySecret'),
                  value: rotatedIdentity.identityVerificationSecret,
                  hint: t('identitySecretHint'),
                },
              ]
            : []
        }
        onClose={() => setRotatedIdentity(null)}
      />

      {embedFor && <EmbedSnippetDialog channel={embedFor} onClose={() => setEmbedFor(null)} />}

      {sendTestFor && (
        <SendTestEmailDialog channel={sendTestFor} onClose={() => setSendTestFor(null)} />
      )}

      <section className="space-y-4">
        <SectionHead
          title={
            channels
              ? t('channelsTitleCount', { count: channels.length })
              : t('channelsTitle')
          }
          actions={
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button size="sm" className="gap-2" />}>
                {t('addChannel')}
                <ChevronDown className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setWidgetOpen(true)}>
                  <MessageSquare className="size-4" />
                  {t('addWidget')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setEmailOpen(true)}>
                  <Mail className="size-4" />
                  {t('addEmail')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
          divider={false}
        />

        {channels === null ? (
          <p className="text-sm text-ink-mute">{tCommon('loading')}</p>
        ) : channels.length === 0 ? (
          <EmptyCallout title={t('emptyTitle')} body={t('emptyBody')} />
        ) : (
          <ul className="space-y-3">
            {channels.map((c) => (
              <ChannelRow
                key={c.id}
                channel={c}
                onRotate={() => {
                  void rotateKey(c);
                }}
                onRotateIdentity={() => {
                  void rotateIdentity(c);
                }}
                onDelete={() => {
                  void deleteChannel(c);
                }}
                onShowEmbed={() => setEmbedFor(c)}
                onEdit={() => setEditEmail(c as EmailChannelDto)}
                onSendTest={() => setSendTestFor(c as EmailChannelDto)}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}


function ChannelRow({
  channel,
  onRotate,
  onRotateIdentity,
  onDelete,
  onShowEmbed,
  onEdit,
  onSendTest,
}: {
  channel: ChannelDto;
  onRotate: () => void;
  onRotateIdentity: () => void;
  onDelete: () => void;
  onShowEmbed: () => void;
  onEdit: () => void;
  onSendTest: () => void;
}) {
  const t = useTranslations('dashboard.channels');
  const tCommon = useTranslations('common');
  const isChat = channel.type === 'chat';
  const widgetConfig = isChat
    ? (channel.config as { originAllowlist?: string[] } | null)
    : null;
  const emailConfig = channel.type === 'email' ? (channel.config as EmailChannelDto['config']) : null;
  const origins = widgetConfig?.originAllowlist ?? [];

  return (
    <li className="border-[0.5px] border-rule-soft dark:border-rule-on-dark bg-paper dark:bg-card px-5 py-4">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <TypeBadge kind={channel.type} label={isChat ? t('typeChat') : t('typeEmail')} />
            <h3 className="font-serif text-lg leading-none text-ink dark:text-foreground">
              {channel.name}
            </h3>
            {!channel.active && (
              <span className="border-[0.5px] border-amber-300 bg-amber-50 px-2 py-0.5 font-mono text-[10px] uppercase tracking-eyebrow text-amber-900">
                {t('inactive')}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {isChat ? (
              origins.length > 0 ? (
                origins.map((o) => <OriginChip key={o} text={o} />)
              ) : (
                <OriginChip text={t('anyOrigin')} muted />
              )
            ) : (
              <>
                {emailConfig?.addressing?.fromAddress && (
                  <span className="font-mono text-[11px] text-ink dark:text-foreground">
                    {emailConfig.addressing.fromName
                      ? `${emailConfig.addressing.fromName} <${emailConfig.addressing.fromAddress}>`
                      : emailConfig.addressing.fromAddress}
                  </span>
                )}
                {emailConfig?.outbound?.provider === 'smtp' && (
                  <OriginChip text={t('smtpServer', { host: emailConfig.outbound.host })} />
                )}
                {emailConfig?.inbound && <OriginChip text={t('imapPolling')} />}
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="flex items-center gap-1">
            {isChat ? (
              <Button variant="outline" size="sm" onClick={onShowEmbed} className="gap-1.5">
                <Code className="size-3.5" />
                {t('showEmbed')}
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={onEdit}>
                {tCommon('edit')}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label={t('moreActions')}
                  />
                }
              >
                <MoreHorizontal className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isChat && (
                  <>
                    <DropdownMenuItem onClick={onRotate}>
                      <KeyRound className="size-4" />
                      {t('rotateKey')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={onRotateIdentity}>
                      <ShieldCheck className="size-4" />
                      {t('rotateIdentity')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {channel.type === 'email' && (
                  <>
                    <DropdownMenuItem onClick={onSendTest}>
                      <Send className="size-4" />
                      {t('sendTestEmail')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem className="text-destructive" onClick={onDelete}>
                  <Trash2 className="size-4" />
                  {t('deleteChannel')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </li>
  );
}

function TypeBadge({ kind, label }: { kind: 'chat' | 'email' | 'voice' | 'sms'; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 font-mono text-[10px] uppercase tracking-eyebrow rounded',
        kind === 'chat'
          ? 'bg-cobalt/15 text-cobalt-deep dark:bg-cobalt-soft/20 dark:text-cobalt-soft'
          : 'bg-auth-navy/15 text-auth-navy dark:bg-auth-navy/30 dark:text-paper',
      )}
    >
      {label}
    </span>
  );
}

function OriginChip({ text, muted }: { text: string; muted?: boolean }) {
  return (
    <span
      className={cn(
        'inline-block border-[0.5px] border-rule-soft dark:border-rule-on-dark bg-paper-deep dark:bg-secondary px-2 py-0.5 font-mono text-[11px]',
        muted ? 'text-ink-mute italic' : 'text-ink dark:text-foreground',
      )}
    >
      {text}
    </span>
  );
}

function CreateWidgetDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const t = useTranslations('dashboard.channels');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const [name, setName] = useState('');
  const [originAllowlist, setOriginAllowlist] = useState('');
  const [originsError, setOriginsError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedWidget | null>(null);
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
    const parsed = CreateWidgetBody.safeParse({
      name: name.trim(),
      originAllowlist: allowlist,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues.find(
        (i) => Array.isArray(i.path) && i.path[0] === 'originAllowlist',
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
      const result = await api<CreatedWidget>('/api/v1/conversations/channels/widget', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      setCreated(result);
      onCreated();
    } catch (err) {
      setSubmitError(
        toSaveErrorDetail(err, translate(err) || t('errors.create'), {
          endpoint: '/api/v1/conversations/channels/widget',
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
              <CopyableSecret label={t('keyLabelWidget')} value={created.widgetKey} />
              {created.identityVerificationSecret && (
                <CopyableSecret
                  label={t('keyLabelIdentitySecret')}
                  value={created.identityVerificationSecret}
                  hint={t('identitySecretHint')}
                />
              )}
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
              <DialogTitle>{t('createWidgetTitle')}</DialogTitle>
              <DialogDescription>{t('createWidgetDescription')}</DialogDescription>
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
                  {creating ? tCommon('creating') : t('createWidget')}
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

function zodIssuesToFieldErrors(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }>,
  t: ReturnType<typeof useTranslations<'dashboard.channels'>>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path;
    const last = path[path.length - 1];
    const parent = path[path.length - 2];
    if (last === 'fromAddress') {
      errors.fromAddress = t('email.fromAddressInvalid');
    } else if (last === 'host') {
      if (parent === 'outbound') errors.smtpHost = t('email.hostInvalid');
      else if (parent === 'inbound') errors.imapHost = t('email.hostInvalid');
    } else if (last === 'port') {
      if (parent === 'outbound') errors.smtpPort = t('email.portInvalid');
      else if (parent === 'inbound') errors.imapPort = t('email.portInvalid');
    }
  }
  return errors;
}

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
    };
  }
  return {
    endpoint: fallback.endpoint,
    method: fallback.method,
    status: '—',
    requestId: null,
  };
}

function parsePositiveInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function EmailChannelDialog({
  open,
  onOpenChange,
  onSaved,
  editChannel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  editChannel: EmailChannelDto | null;
}) {
  const isEdit = editChannel !== null;
  const t = useTranslations('dashboard.channels');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const [name, setName] = useState('');
  const [fromAddress, setFromAddress] = useState('');
  const [fromName, setFromName] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUsername, setSmtpUsername] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [trackOpens, setTrackOpens] = useState(false);
  const [enableInbound, setEnableInbound] = useState(false);
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState('993');
  const [imapSecure, setImapSecure] = useState(true);
  const [imapUsername, setImapUsername] = useState('');
  const [imapPassword, setImapPassword] = useState('');
  const [imapMailbox, setImapMailbox] = useState('');
  const [perDayMax, setPerDayMax] = useState('');
  const [perHourMax, setPerHourMax] = useState('');
  const [creating, setCreating] = useState(false);
  const [submitError, setSubmitError] = useState<SaveErrorDetail | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const clearFieldError = (key: string) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  useEffect(() => {
    if (!open) return;
    const cfg = editChannel?.config;
    setName(editChannel?.name ?? '');
    setFromAddress(cfg?.addressing?.fromAddress ?? '');
    setFromName(cfg?.addressing?.fromName ?? '');
    setSmtpHost(cfg?.outbound?.host ?? '');
    setSmtpPort(cfg?.outbound?.port != null ? String(cfg.outbound.port) : '587');
    setSmtpSecure(cfg?.outbound?.secure ?? false);
    setSmtpUsername(cfg?.outbound?.username ?? '');
    setSmtpPassword('');
    setTrackOpens(cfg?.outbound?.trackOpens ?? false);
    setEnableInbound(cfg?.inbound != null);
    setImapHost(cfg?.inbound?.host ?? '');
    setImapPort(cfg?.inbound?.port != null ? String(cfg.inbound.port) : '993');
    setImapSecure(cfg?.inbound?.secure ?? true);
    setImapUsername(cfg?.inbound?.username ?? '');
    setImapPassword('');
    setImapMailbox(cfg?.inbound?.mailbox ?? '');
    setPerDayMax(
      cfg?.sendLimits?.perDayMax != null ? String(cfg.sendLimits.perDayMax) : '',
    );
    setPerHourMax(
      cfg?.sendLimits?.perHourMax != null ? String(cfg.sendLimits.perHourMax) : '',
    );
    setSubmitError(null);
    setFieldErrors({});
    setCreating(false);
  }, [open, editChannel]);

  async function submit() {
    if (!name.trim() || !fromAddress.trim() || !smtpHost.trim()) return;
    if (!isEdit && !smtpPassword) return;
    const payload = {
      ...(isEdit && editChannel ? { channelId: editChannel.id } : {}),
      name: name.trim(),
      config: {
        addressing: {
          fromAddress: fromAddress.trim(),
          ...(fromName.trim() ? { fromName: fromName.trim() } : {}),
        },
        outbound: {
          provider: 'smtp' as const,
          host: smtpHost.trim(),
          port: Number.parseInt(smtpPort, 10),
          secure: smtpSecure,
          username: smtpUsername.trim(),
          ...(smtpPassword ? { password: smtpPassword } : {}),
          trackOpens,
        },
        ...(enableInbound
          ? {
              inbound: {
                provider: 'imap' as const,
                host: imapHost.trim(),
                port: Number.parseInt(imapPort, 10),
                secure: imapSecure,
                username: imapUsername.trim(),
                ...(imapPassword ? { password: imapPassword } : {}),
                ...(imapMailbox.trim() ? { mailbox: imapMailbox.trim() } : {}),
              },
            }
          : {}),
        ...(() => {
          const sendLimits: { perDayMax?: number; perHourMax?: number } = {};
          const day = parsePositiveInt(perDayMax);
          const hour = parsePositiveInt(perHourMax);
          if (day !== null) sendLimits.perDayMax = day;
          if (hour !== null) sendLimits.perHourMax = hour;
          return Object.keys(sendLimits).length > 0 ? { sendLimits } : {};
        })(),
      },
    };
    const parsed = SetupEmailBody.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(zodIssuesToFieldErrors(parsed.error.issues, t));
      return;
    }
    setFieldErrors({});
    setCreating(true);
    setSubmitError(null);
    try {
      await api('/api/v1/conversations/channels/email', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setSubmitError(
        toSaveErrorDetail(
          err,
          translate(err) || t(isEdit ? 'errors.updateEmail' : 'errors.createEmail'),
          {
            endpoint: '/api/v1/conversations/channels/email',
            method: 'POST',
          },
        ),
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {submitError ? (
          <SaveErrorStage
            detail={submitError}
            onBack={() => setSubmitError(null)}
            onRetry={() => void submit()}
            retrying={creating}
          />
        ) : (
          <>
        <DialogHeader>
          <DialogTitle>{t(isEdit ? 'email.editTitle' : 'email.createTitle')}</DialogTitle>
          <DialogDescription>
            {t(isEdit ? 'email.editDescription' : 'email.createDescription')}
          </DialogDescription>
        </DialogHeader>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={t('nameLabel')}>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. support-inbox"
                maxLength={120}
                required
              />
            </FormField>
            <FormField label={t('email.fromAddressLabel')} error={fieldErrors.fromAddress}>
              <Input
                type="email"
                value={fromAddress}
                onChange={(e) => {
                  setFromAddress(e.target.value);
                  clearFieldError('fromAddress');
                }}
                placeholder="support@example.com"
                required
                aria-invalid={fieldErrors.fromAddress ? true : undefined}
              />
            </FormField>
            <FormField label={t('email.fromNameLabel')}>
              <Input
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder="Acme Support"
                maxLength={120}
              />
            </FormField>
          </div>

          <fieldset className="space-y-3 rounded-md border-[0.5px] px-3 pb-3">
            <legend className="px-2 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">{t('email.outboundLabel')}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label={t('email.host')} error={fieldErrors.smtpHost}>
                <Input
                  value={smtpHost}
                  onChange={(e) => {
                    setSmtpHost(e.target.value);
                    clearFieldError('smtpHost');
                  }}
                  placeholder="smtp.example.com"
                  required
                  aria-invalid={fieldErrors.smtpHost ? true : undefined}
                />
              </FormField>
              <FormField label={t('email.port')} error={fieldErrors.smtpPort}>
                <Input
                  type="number"
                  value={smtpPort}
                  onChange={(e) => {
                    setSmtpPort(e.target.value);
                    clearFieldError('smtpPort');
                  }}
                  required
                  aria-invalid={fieldErrors.smtpPort ? true : undefined}
                />
              </FormField>
              <FormField label={t('email.username')}>
                <Input
                  value={smtpUsername}
                  onChange={(e) => setSmtpUsername(e.target.value)}
                  required
                />
              </FormField>
              <FormField label={t('email.password')}>
                <Input
                  type="password"
                  value={smtpPassword}
                  onChange={(e) => setSmtpPassword(e.target.value)}
                  placeholder="••••••••"
                  required={!isEdit}
                />
              </FormField>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={smtpSecure}
                  onChange={(e) => setSmtpSecure(e.target.checked)}
                />
                {t('email.secure')}
              </label>
              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={trackOpens}
                  onChange={(e) => setTrackOpens(e.target.checked)}
                />
                <span>
                  {t('email.trackOpens')}
                  <span className="block text-[11px] text-ink-mute">
                    {t('email.trackOpensHint')}
                  </span>
                </span>
              </label>
            </div>
          </fieldset>

          <fieldset className="space-y-3 rounded-md border-[0.5px] px-3 pb-3">
            <legend className="px-2 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">{t('email.inboundLabel')}</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enableInbound}
                onChange={(e) => setEnableInbound(e.target.checked)}
              />
              {t('email.enableInbound')}
            </label>
            {enableInbound && (
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label={t('email.host')} error={fieldErrors.imapHost}>
                  <Input
                    value={imapHost}
                    onChange={(e) => {
                      setImapHost(e.target.value);
                      clearFieldError('imapHost');
                    }}
                    placeholder="imap.example.com"
                    required
                    aria-invalid={fieldErrors.imapHost ? true : undefined}
                  />
                </FormField>
                <FormField label={t('email.port')} error={fieldErrors.imapPort}>
                  <Input
                    type="number"
                    value={imapPort}
                    onChange={(e) => {
                      setImapPort(e.target.value);
                      clearFieldError('imapPort');
                    }}
                    required
                    aria-invalid={fieldErrors.imapPort ? true : undefined}
                  />
                </FormField>
                <FormField label={t('email.username')}>
                  <Input
                    value={imapUsername}
                    onChange={(e) => setImapUsername(e.target.value)}
                    required
                  />
                </FormField>
                <FormField label={t('email.password')}>
                  <Input
                    type="password"
                    value={imapPassword}
                    onChange={(e) => setImapPassword(e.target.value)}
                    placeholder="••••••••"
                    required={!isEdit || !editChannel?.config.inbound}
                  />
                </FormField>
                <FormField label={t('email.mailbox')}>
                  <Input
                    value={imapMailbox}
                    onChange={(e) => setImapMailbox(e.target.value)}
                    placeholder="INBOX"
                    maxLength={120}
                  />
                </FormField>
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={imapSecure}
                    onChange={(e) => setImapSecure(e.target.checked)}
                  />
                  {t('email.secure')}
                </label>
              </div>
            )}
          </fieldset>

          <fieldset className="rounded-md border border-rule-soft px-4 pb-4 pt-3">
            <legend className="px-2 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
              {t('email.sendLimitsLabel')}
            </legend>
            <p className="text-xs text-muted-foreground">{t('email.sendLimitsHelp')}</p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label={t('email.perDayMax')}>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={perDayMax}
                  onChange={(e) => setPerDayMax(e.target.value)}
                  placeholder={t('email.sendLimitsPlaceholder')}
                />
              </FormField>
              <FormField label={t('email.perHourMax')}>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={perHourMax}
                  onChange={(e) => setPerHourMax(e.target.value)}
                  placeholder={t('email.sendLimitsPlaceholder')}
                />
              </FormField>
            </div>
          </fieldset>

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
              {creating
                ? tCommon(isEdit ? 'saving' : 'creating')
                : isEdit
                  ? tCommon('saveChanges')
                  : t('email.create')}
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


function SendTestEmailDialog({
  channel,
  onClose,
}: {
  channel: EmailChannelDto;
  onClose: () => void;
}) {
  const t = useTranslations('dashboard.channels');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const { data: session } = authClient.useSession();
  const defaultEmail = session?.user?.email ?? '';
  const [to, setTo] = useState(defaultEmail);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setTo(defaultEmail);
    setError(null);
    setSending(false);
  }, [defaultEmail]);

  async function submit() {
    const trimmed = to.trim();
    if (!trimmed) return;
    setSending(true);
    setError(null);
    try {
      await api(`/api/v1/conversations/channels/email/${channel.id}/send-test`, {
        method: 'POST',
        body: JSON.stringify({ to: trimmed }),
      });
      notify.success(t('sendTest.success', { to: trimmed }));
      onClose();
    } catch (err) {
      setError(translate(err) || t('errors.sendTest'));
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('sendTest.title')}</DialogTitle>
          <DialogDescription>
            {t('sendTest.description', { name: channel.name })}
          </DialogDescription>
        </DialogHeader>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <FormField label={t('sendTest.toLabel')} hint={t('sendTest.toHint')} error={error ?? undefined}>
            <Input
              type="email"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                if (error) setError(null);
              }}
              required
              autoFocus
              aria-invalid={error ? true : undefined}
            />
          </FormField>
          <DialogFooter className={dialogFooterClass}>
            <Button
              type="button"
              variant="outline"
              className={dialogButtonClass}
              onClick={onClose}
              disabled={sending}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              type="submit"
              variant="accent"
              className={dialogButtonClass}
              disabled={sending || !to.trim()}
              pending={sending}
            >
              {sending ? t('sendTest.sending') : t('sendTest.submit')}
              <span aria-hidden className="ml-1 font-mono">↵</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface CalloutRow {
  label: string;
  value: string;
  hint?: string;
}

function RotatedSecretDialog({
  open,
  title,
  description,
  rows,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  rows: CalloutRow[];
  onClose: () => void;
}) {
  const tCommon = useTranslations('common');
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="mt-2 flex flex-col gap-4">
          {rows.map((row) => (
            <CopyableSecret key={row.label} label={row.label} value={row.value} hint={row.hint} />
          ))}
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

function CopyableSecret({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const tCommon = useTranslations('common');
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), KEY_DISPLAY_TIMEOUT_MS);
    });
  }
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded-md border-[0.5px] bg-background px-3 py-2 font-mono text-sm">
          {value}
        </code>
        <Button variant="outline" size="sm" onClick={copy}>
          <Copy className="size-4" />
          {copied ? tCommon('copied') : tCommon('copy')}
        </Button>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const HASH_SNIPPETS: Array<{ language: string; label: string; build: (channelId: string) => string }> = [
  {
    language: 'node',
    label: 'Node.js',
    build: () => `// Compute on every request, signed with your channel's identity secret.
import crypto from 'node:crypto';
const userHash = crypto
  .createHmac('sha256', process.env.MUNIN_IDENTITY_SECRET)
  .update(externalId)        // your stable user id
  .digest('hex');`,
  },
  {
    language: 'ruby',
    label: 'Ruby',
    build: () => `require 'openssl'
user_hash = OpenSSL::HMAC.hexdigest(
  'sha256', ENV['MUNIN_IDENTITY_SECRET'], external_id
)`,
  },
  {
    language: 'php',
    label: 'PHP',
    build: () => `$userHash = hash_hmac(
  'sha256',
  $externalId,
  getenv('MUNIN_IDENTITY_SECRET')
);`,
  },
  {
    language: 'python',
    label: 'Python',
    build: () => `import hmac, hashlib, os
user_hash = hmac.new(
    os.environ['MUNIN_IDENTITY_SECRET'].encode(),
    external_id.encode(),
    hashlib.sha256,
).hexdigest()`,
  },
];

function EmbedSnippetDialog({
  channel,
  onClose,
}: {
  channel: ChannelDto;
  onClose: () => void;
}) {
  const t = useTranslations('dashboard.channels');
  const tCommon = useTranslations('common');
  const [language, setLanguage] = useState(HASH_SNIPPETS[0]!.language);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [hashCopied, setHashCopied] = useState(false);

  const host = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
  const scriptSnippet = [
    `<script src="${host}/widget.js"`,
    `        data-munin-host="${host}"`,
    `        data-widget-key="<your widget key>"`,
    `        data-channel-id="${channel.id}"`,
    `        data-munin-fonts="system"`,
    `        defer></script>`,
  ].join('\n');

  const hashSnippet = HASH_SNIPPETS.find((s) => s.language === language)!.build(channel.id);

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
          <DialogTitle>{t('embed.title', { name: channel.name })}</DialogTitle>
          <DialogDescription>{t('embed.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-8 py-2">
          <div className="space-y-3">
            <Label className={dialogLabelClass}>{t('embed.scriptLabel')}</Label>
            <pre className="overflow-x-auto rounded-md border-[0.5px] bg-muted px-3 py-2 font-mono text-xs">
              {scriptSnippet}
            </pre>
            <Button variant="outline" size="sm" onClick={copySnippet}>
              <Copy className="size-4" />
              {snippetCopied ? tCommon('copied') : t('embed.copyScript')}
            </Button>
            <p className={dialogHintClass}>{t('embed.scriptHint')}</p>
            <a href="/docs/guides/chat-widget" target="_blank" rel="noreferrer" className="text-[13px] underline">
              {t('embed.guideLinkLabel')}
            </a>
          </div>

          <div className="space-y-3">
            <Label className={dialogLabelClass}>{t('embed.hashLabel')}</Label>
            <p className={dialogHintClass}>{t('embed.hashHint')}</p>
            <div className="flex w-fit border-[0.5px] border-ink dark:border-foreground">
              {HASH_SNIPPETS.map((s) => {
                const active = s.language === language;
                return (
                  <button
                    key={s.language}
                    type="button"
                    onClick={() => setLanguage(s.language)}
                    className={cn(
                      'w-24 h-7 px-2.5 font-mono text-[11px] uppercase tracking-eyebrow border-r-[0.5px] border-rule-soft last:border-r-0 transition-colors duration-fast ease-munin',
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
            <pre className="overflow-x-auto rounded-md border-[0.5px] bg-muted px-3 py-2 font-mono text-xs">
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
