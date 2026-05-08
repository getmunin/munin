'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  Copy,
  Globe,
  Mail,
  MessageSquare,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { api } from '../api';
import { useTranslateError } from '../i18n/translate-error';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Hero,
  Input,
  Label,
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
    outbound?: { provider: 'smtp'; host: string; port: number };
    inbound?: { provider: 'imap'; host: string; port: number };
  };
}

interface CreatedWidget {
  id: string;
  name: string;
  widgetKey: string;
}

const KEY_DISPLAY_TIMEOUT_MS = 1500;

export function ChannelsPage() {
  const t = useTranslations('dashboard.channels');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const format = useFormatter();
  const [channels, setChannels] = useState<ChannelDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [justCreated, setJustCreated] = useState<CreatedWidget | null>(null);
  const [rotated, setRotated] = useState<CreatedWidget | null>(null);

  async function load() {
    try {
      setError(null);
      const list = await api<{ items: ChannelDto[] }>('/api/conv/channels');
      setChannels(list.items);
    } catch (err) {
      setError(translate(err) || t('errors.load'));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function rotateKey(channel: ChannelDto) {
    if (!confirm(t('rotateConfirm', { name: channel.name }))) return;
    try {
      const result = await api<{ widgetKey: string }>(
        `/api/conv/channels/widget/${channel.id}/rotate-key`,
        { method: 'POST' },
      );
      setRotated({ id: channel.id, name: channel.name, widgetKey: result.widgetKey });
    } catch (err) {
      setError(translate(err) || t('errors.rotate'));
    }
  }

  return (
    <>
      <Hero
        title={t('title')}
        lede={t('subtitle')}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button className="gap-2" />}>
              {t('addChannel')}
              <ChevronDown className="size-4" />
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
      />

      <CreateWidgetDialog
        open={widgetOpen}
        onOpenChange={setWidgetOpen}
        onCreated={(created) => {
          setJustCreated(created);
          void load();
        }}
        onError={(msg) => setError(msg)}
      />

      <CreateEmailDialog
        open={emailOpen}
        onOpenChange={setEmailOpen}
        onCreated={() => {
          void load();
        }}
        onError={(msg) => setError(msg)}
      />

      {justCreated && (
        <KeyCallout
          title={t('createdTitle')}
          description={t('createdDescription', { name: justCreated.name })}
          keyValue={justCreated.widgetKey}
          onDismiss={() => setJustCreated(null)}
        />
      )}

      {rotated && (
        <KeyCallout
          title={t('rotatedTitle')}
          description={t('rotatedDescription', { name: rotated.name })}
          keyValue={rotated.widgetKey}
          onDismiss={() => setRotated(null)}
        />
      )}

      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {channels === null ? (
        <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
      ) : channels.length === 0 ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <MessageSquare className="size-5 text-muted-foreground" />
              <CardTitle>{t('emptyTitle')}</CardTitle>
            </div>
            <CardDescription>{t('emptyBody')}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-2">
          {channels.map((c) => (
            <ChannelRow
              key={c.id}
              channel={c}
              onRotate={() => {
                void rotateKey(c);
              }}
              onErrorMessage={(msg) => setError(msg)}
              createdLabel={format.dateTime(new Date(c.createdAt), { dateStyle: 'medium' })}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function ChannelRow({
  channel,
  onRotate,
  onErrorMessage,
  createdLabel,
}: {
  channel: ChannelDto;
  onRotate: () => void;
  onErrorMessage: (msg: string) => void;
  createdLabel: string;
}) {
  const t = useTranslations('dashboard.channels');
  const widgetConfig =
    channel.type === 'chat'
      ? (channel.config as { displayName?: string; originAllowlist?: string[] } | null)
      : null;
  const emailConfig = channel.type === 'email' ? (channel.config as EmailChannelDto['config']) : null;
  const origins = widgetConfig?.originAllowlist ?? [];
  return (
    <li className="rounded-lg border bg-background px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">{channel.name}</p>
            <span className="rounded-full border px-2 py-0.5 text-xs uppercase tracking-wide text-muted-foreground">
              {channel.type}
            </span>
            {!channel.active && (
              <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-900">
                {t('inactive')}
              </span>
            )}
          </div>
          {widgetConfig?.displayName && (
            <p className="text-xs text-muted-foreground">
              {t('displayNameLabel')}: <span className="font-medium">{widgetConfig.displayName}</span>
            </p>
          )}
          {origins.length > 0 && (
            <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <Globe className="size-3" />
              {origins.map((o) => (
                <code key={o} className="rounded bg-muted px-1.5 py-0.5 font-mono">
                  {o}
                </code>
              ))}
            </p>
          )}
          {emailConfig?.addressing?.fromAddress && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Mail className="size-3" />
              <span className="font-mono">{emailConfig.addressing.fromAddress}</span>
              {emailConfig.outbound?.provider === 'smtp' && (
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono">
                  smtp://{emailConfig.outbound.host}:{emailConfig.outbound.port}
                </span>
              )}
              {emailConfig.inbound && (
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono">
                  imap://{emailConfig.inbound.host}:{emailConfig.inbound.port}
                </span>
              )}
            </p>
          )}
          <p className="text-xs text-muted-foreground">{t('createdAt', { date: createdLabel })}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {channel.type === 'chat' && (
            <Button variant="outline" size="sm" onClick={onRotate}>
              <RefreshCw className="size-4" />
              {t('rotateKey')}
            </Button>
          )}
          {channel.type === 'email' && (
            <EmailTestButton channelId={channel.id} onError={onErrorMessage} />
          )}
        </div>
      </div>
    </li>
  );
}

function EmailTestButton({
  channelId,
  onError,
}: {
  channelId: string;
  onError: (msg: string) => void;
}) {
  const t = useTranslations('dashboard.channels');
  const translate = useTranslateError();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ smtp: string; imap: string } | null>(null);
  async function run() {
    setTesting(true);
    setResult(null);
    try {
      const r = await api<{ smtp: string; imap: string }>(
        `/api/conv/channels/email/${channelId}/test`,
        { method: 'POST' },
      );
      setResult(r);
    } catch (err) {
      onError(translate(err) || t('errors.test'));
    } finally {
      setTesting(false);
    }
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" onClick={() => void run()} disabled={testing}>
        {testing ? t('testing') : t('test')}
      </Button>
      {result && (
        <div className="flex items-center gap-2 text-xs">
          <TestStatus label="SMTP" status={result.smtp} />
          <TestStatus label="IMAP" status={result.imap} />
        </div>
      )}
    </div>
  );
}

function TestStatus({ label, status }: { label: string; status: string }) {
  const ok = status === 'ok';
  const skipped = status === 'not configured';
  return (
    <span className="flex items-center gap-1">
      <span className="font-medium">{label}:</span>
      {ok ? (
        <CheckCircle2 className="size-3 text-emerald-600" />
      ) : skipped ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <XCircle className="size-3 text-red-600" />
      )}
      {!ok && !skipped && <span className="max-w-40 truncate text-red-700">{status}</span>}
    </span>
  );
}

function CreateWidgetDialog({
  open,
  onOpenChange,
  onCreated,
  onError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (created: CreatedWidget) => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations('dashboard.channels');
  const translate = useTranslateError();
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [originAllowlist, setOriginAllowlist] = useState('');
  const [creating, setCreating] = useState(false);

  function reset() {
    setName('');
    setDisplayName('');
    setOriginAllowlist('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !displayName.trim()) return;
    setCreating(true);
    try {
      const allowlist = originAllowlist
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const created = await api<CreatedWidget>('/api/conv/channels/widget', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          displayName: displayName.trim(),
          originAllowlist: allowlist,
        }),
      });
      onCreated(created);
      reset();
      onOpenChange(false);
    } catch (err) {
      onError(translate(err) || t('errors.create'));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('createWidgetTitle')}</DialogTitle>
          <DialogDescription>{t('createWidgetDescription')}</DialogDescription>
        </DialogHeader>
        <form className="mt-4 flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <Field label={t('nameLabel')}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('namePlaceholder')}
              required
            />
          </Field>
          <Field label={t('displayNameLabel')}>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t('displayNamePlaceholder')}
              required
            />
          </Field>
          <Field label={t('originsLabel')} hint={t('originsHint')}>
            <Input
              value={originAllowlist}
              onChange={(e) => setOriginAllowlist(e.target.value)}
              placeholder="https://example.com, https://www.example.com"
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? t('creating') : t('createWidget')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateEmailDialog({
  open,
  onOpenChange,
  onCreated,
  onError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations('dashboard.channels');
  const translate = useTranslateError();
  const [name, setName] = useState('');
  const [fromAddress, setFromAddress] = useState('');
  const [fromName, setFromName] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUsername, setSmtpUsername] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [enableInbound, setEnableInbound] = useState(false);
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState('993');
  const [imapSecure, setImapSecure] = useState(true);
  const [imapUsername, setImapUsername] = useState('');
  const [imapPassword, setImapPassword] = useState('');
  const [imapMailbox, setImapMailbox] = useState('');
  const [creating, setCreating] = useState(false);

  function reset() {
    setName('');
    setFromAddress('');
    setFromName('');
    setSmtpHost('');
    setSmtpPort('587');
    setSmtpSecure(false);
    setSmtpUsername('');
    setSmtpPassword('');
    setEnableInbound(false);
    setImapHost('');
    setImapPort('993');
    setImapSecure(true);
    setImapUsername('');
    setImapPassword('');
    setImapMailbox('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !fromAddress.trim() || !smtpHost.trim() || !smtpPassword) return;
    setCreating(true);
    try {
      const config: Record<string, unknown> = {
        addressing: {
          fromAddress: fromAddress.trim(),
          ...(fromName.trim() ? { fromName: fromName.trim() } : {}),
        },
        outbound: {
          provider: 'smtp',
          host: smtpHost.trim(),
          port: Number.parseInt(smtpPort, 10),
          secure: smtpSecure,
          username: smtpUsername.trim(),
          password: smtpPassword,
        },
      };
      if (enableInbound) {
        config.inbound = {
          provider: 'imap',
          host: imapHost.trim(),
          port: Number.parseInt(imapPort, 10),
          secure: imapSecure,
          username: imapUsername.trim(),
          password: imapPassword,
          ...(imapMailbox.trim() ? { mailbox: imapMailbox.trim() } : {}),
        };
      }
      await api('/api/conv/channels/email', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), config }),
      });
      reset();
      onOpenChange(false);
      onCreated();
    } catch (err) {
      onError(translate(err) || t('errors.createEmail'));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('email.createTitle')}</DialogTitle>
          <DialogDescription>{t('email.createDescription')}</DialogDescription>
        </DialogHeader>
        <form className="mt-4 flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('nameLabel')}>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. support-inbox"
                required
              />
            </Field>
            <Field label={t('email.fromAddressLabel')}>
              <Input
                type="email"
                value={fromAddress}
                onChange={(e) => setFromAddress(e.target.value)}
                placeholder="support@example.com"
                required
              />
            </Field>
            <Field label={t('email.fromNameLabel')}>
              <Input
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder="Acme Support"
              />
            </Field>
          </div>

          <fieldset className="space-y-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">{t('email.outboundLabel')}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('email.host')}>
                <Input
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  placeholder="smtp.example.com"
                  required
                />
              </Field>
              <Field label={t('email.port')}>
                <Input
                  type="number"
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(e.target.value)}
                  required
                />
              </Field>
              <Field label={t('email.username')}>
                <Input
                  value={smtpUsername}
                  onChange={(e) => setSmtpUsername(e.target.value)}
                  required
                />
              </Field>
              <Field label={t('email.password')}>
                <Input
                  type="password"
                  value={smtpPassword}
                  onChange={(e) => setSmtpPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </Field>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={smtpSecure}
                  onChange={(e) => setSmtpSecure(e.target.checked)}
                />
                {t('email.secure')}
              </label>
            </div>
          </fieldset>

          <fieldset className="space-y-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">{t('email.inboundLabel')}</legend>
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
                <Field label={t('email.host')}>
                  <Input
                    value={imapHost}
                    onChange={(e) => setImapHost(e.target.value)}
                    placeholder="imap.example.com"
                    required
                  />
                </Field>
                <Field label={t('email.port')}>
                  <Input
                    type="number"
                    value={imapPort}
                    onChange={(e) => setImapPort(e.target.value)}
                    required
                  />
                </Field>
                <Field label={t('email.username')}>
                  <Input
                    value={imapUsername}
                    onChange={(e) => setImapUsername(e.target.value)}
                    required
                  />
                </Field>
                <Field label={t('email.password')}>
                  <Input
                    type="password"
                    value={imapPassword}
                    onChange={(e) => setImapPassword(e.target.value)}
                    required
                  />
                </Field>
                <Field label={t('email.mailbox')}>
                  <Input
                    value={imapMailbox}
                    onChange={(e) => setImapMailbox(e.target.value)}
                    placeholder="INBOX"
                  />
                </Field>
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

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? t('creating') : t('email.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function KeyCallout({
  title,
  description,
  keyValue,
  onDismiss,
}: {
  title: string;
  description: string;
  keyValue: string;
  onDismiss: () => void;
}) {
  const t = useTranslations('dashboard.channels');
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard.writeText(keyValue).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), KEY_DISPLAY_TIMEOUT_MS);
    });
  }
  return (
    <Card className="border-emerald-200 bg-emerald-50">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-md border bg-background px-3 py-2 font-mono text-sm">
            {keyValue}
          </code>
          <Button variant="outline" size="sm" onClick={copy}>
            <Copy className="size-4" />
            {copied ? t('copied') : t('copy')}
          </Button>
        </div>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          {t('savedIt')}
        </Button>
      </CardContent>
    </Card>
  );
}
