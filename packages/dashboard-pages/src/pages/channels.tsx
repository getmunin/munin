'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ChevronDown,
  Code,
  Copy,
  Mail,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  Phone,
  RefreshCw,
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
import { NativeSelect } from '../components/native-select';
import { useLoadGate } from '../lib/use-load-gate';
import { useSettingsLoadFailedProps } from '../lib/use-load-failed-props';
import { notify } from '../lib/notify';
import {
  CreateWidgetBody,
  SetupEmailBody,
  ConfigureTwilioSmsBody,
  SendTwilioSmsTestBody,
  ConfigureMessageBirdSmsBody,
  SendMessageBirdSmsTestBody,
  ConfigureVapiBody,
  VapiCallInitiateBody,
  ConfigureThrellBody,
  ThrellCallInitiateBody,
} from '@getmunin/types';
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
import { MessageBirdLogo, ThrellLogo, TwilioLogo, VapiLogo } from './channel-vendor-logos';

interface ChannelDto {
  id: string;
  type: 'email' | 'voice' | 'chat' | 'sms';
  vendor: string;
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

interface TwilioSmsChannelDto extends ChannelDto {
  type: 'sms';
  vendor: 'twilio';
  config: {
    accountSid?: string;
    authToken?: string;
    fromNumber?: string | null;
    messagingServiceSid?: string | null;
  };
}

interface MessageBirdSmsChannelDto extends ChannelDto {
  type: 'sms';
  vendor: 'messagebird';
  config: {
    accessKey?: string;
    signingKey?: string;
    originator?: string;
  };
}

interface VapiChannelDto extends ChannelDto {
  type: 'voice';
  vendor: 'vapi';
  config: {
    apiKey?: string;
    webhookSecret?: string;
    assistantId?: string;
    phoneNumberId?: string | null;
    publicKey?: string | null;
  };
}

interface ThrellChannelDto extends ChannelDto {
  type: 'voice';
  vendor: 'threll';
  config: {
    apiKey?: string;
    webhookSecret?: string;
    accountId?: string;
    workerId?: string;
  };
}

interface ChannelOptionItem {
  value: string;
  label: string;
  hint?: string | null;
}

interface ChannelOptionGroup {
  key: string;
  label: string;
  options: ChannelOptionItem[];
}

interface ChannelOptionsResponse {
  groups: ChannelOptionGroup[];
  context?: { label?: string };
}

function channelOptionsFor(res: ChannelOptionsResponse, key: string): ChannelOptionItem[] {
  return res.groups.find((g) => g.key === key)?.options ?? [];
}

function optionLabel(option: ChannelOptionItem): string {
  return option.hint ? `${option.label} (${option.hint})` : option.label;
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

interface ChannelAlertDto {
  id: string;
  source: string;
  subjectId: string | null;
  severity: 'warning' | 'error';
  title: string;
  detail: string | null;
  metadata: {
    attemptCount?: number;
    threshold?: number;
    deactivatedAt?: string;
    channelName?: string;
  };
  resolvedAt: string | null;
  openedAt: string;
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
  const [addSmsOpen, setAddSmsOpen] = useState(false);
  const [editTwilioSms, setEditTwilioSms] = useState<TwilioSmsChannelDto | null>(null);
  const [editMessageBirdSms, setEditMessageBirdSms] = useState<MessageBirdSmsChannelDto | null>(null);
  const [addVoiceOpen, setAddVoiceOpen] = useState(false);
  const [editVapi, setEditVapi] = useState<VapiChannelDto | null>(null);
  const [placeVapiCallFor, setPlaceVapiCallFor] = useState<VapiChannelDto | null>(null);
  const [editThrell, setEditThrell] = useState<ThrellChannelDto | null>(null);
  const [placeThrellCallFor, setPlaceThrellCallFor] = useState<ThrellChannelDto | null>(null);
  const [rotated, setRotated] = useState<CreatedWidget | null>(null);
  const [rotatedIdentity, setRotatedIdentity] = useState<RotatedIdentity | null>(null);
  const [embedFor, setEmbedFor] = useState<ChannelDto | null>(null);
  const [sendTestFor, setSendTestFor] = useState<EmailChannelDto | null>(null);
  const [sendSmsTestFor, setSendSmsTestFor] = useState<TwilioSmsChannelDto | null>(null);
  const [sendMessageBirdTestFor, setSendMessageBirdTestFor] =
    useState<MessageBirdSmsChannelDto | null>(null);
  const [alerts, setAlerts] = useState<Record<string, ChannelAlertDto>>({});

  const load = useCallback(async () => {
    const [list, alertsRes] = await Promise.all([
      api<{ items: ChannelDto[] }>('/v1/conversations/channels'),
      api<{ items: ChannelAlertDto[] }>('/v1/system/alerts?source=channel_inbound').catch(() => ({
        items: [],
      })),
    ]);
    setChannels(list.items);
    const byChannel: Record<string, ChannelAlertDto> = {};
    for (const alert of alertsRes.items) {
      if (alert.subjectId && !alert.resolvedAt) byChannel[alert.subjectId] = alert;
    }
    setAlerts(byChannel);
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
        `/v1/conversations/channels/widget/${channel.id}/rotate-key`,
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
        `/v1/conversations/channels/widget/${channel.id}/rotate-identity-secret`,
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

  async function activateChannel(channel: ChannelDto) {
    try {
      await api(`/v1/conversations/channels/${channel.id}/activate`, { method: 'POST' });
      await tryLoad();
    } catch (err) {
      notify.error(translate(err) || t('errors.activate'));
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
      await api(`/v1/conversations/channels/${channel.id}`, { method: 'DELETE' });
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

      <AddSmsDialog
        open={addSmsOpen}
        onOpenChange={setAddSmsOpen}
        onSaved={() => {
          void tryLoad();
        }}
      />

      {editTwilioSms && (
        <TwilioSmsChannelDialog
          open
          editChannel={editTwilioSms}
          onOpenChange={(next) => {
            if (!next) setEditTwilioSms(null);
          }}
          onSaved={() => {
            void tryLoad();
          }}
        />
      )}

      {editMessageBirdSms && (
        <MessageBirdSmsChannelDialog
          open
          editChannel={editMessageBirdSms}
          onOpenChange={(next) => {
            if (!next) setEditMessageBirdSms(null);
          }}
          onSaved={() => {
            void tryLoad();
          }}
        />
      )}

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

      {sendSmsTestFor && (
        <SendTestSmsDialog
          channel={sendSmsTestFor}
          onClose={() => setSendSmsTestFor(null)}
        />
      )}

      {sendMessageBirdTestFor && (
        <SendTestMessageBirdSmsDialog
          channel={sendMessageBirdTestFor}
          onClose={() => setSendMessageBirdTestFor(null)}
        />
      )}

      <AddVoiceDialog
        open={addVoiceOpen}
        onOpenChange={setAddVoiceOpen}
        onSaved={() => {
          void tryLoad();
        }}
      />

      {editVapi && (
        <VapiChannelDialog
          open
          editChannel={editVapi}
          onOpenChange={(next) => {
            if (!next) setEditVapi(null);
          }}
          onSaved={() => {
            void tryLoad();
          }}
        />
      )}

      {placeVapiCallFor && (
        <PlaceVapiCallDialog
          channel={placeVapiCallFor}
          onClose={() => setPlaceVapiCallFor(null)}
        />
      )}

      {editThrell && (
        <ThrellChannelDialog
          open
          editChannel={editThrell}
          onOpenChange={(next) => {
            if (!next) setEditThrell(null);
          }}
          onSaved={() => {
            void tryLoad();
          }}
        />
      )}

      {placeThrellCallFor && (
        <PlaceThrellCallDialog
          channel={placeThrellCallFor}
          onClose={() => setPlaceThrellCallFor(null)}
        />
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
                <DropdownMenuItem onClick={() => setAddSmsOpen(true)}>
                  <MessageCircle className="size-4" />
                  {t('addSms')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setAddVoiceOpen(true)}>
                  <Phone className="size-4" />
                  {t('addVoice')}
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
                alert={alerts[c.id] ?? null}
                onActivate={() => {
                  void activateChannel(c);
                }}
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
                onEdit={() => {
                  if (c.type === 'sms' && c.vendor === 'twilio') {
                    setEditTwilioSms(c as TwilioSmsChannelDto);
                  } else if (c.type === 'sms' && c.vendor === 'messagebird') {
                    setEditMessageBirdSms(c as MessageBirdSmsChannelDto);
                  } else if (c.type === 'voice' && c.vendor === 'vapi') {
                    setEditVapi(c as VapiChannelDto);
                  } else if (c.type === 'voice' && c.vendor === 'threll') {
                    setEditThrell(c as ThrellChannelDto);
                  } else if (c.type === 'email') {
                    setEditEmail(c as EmailChannelDto);
                  }
                }}
                onSendTest={() => {
                  if (c.type === 'sms' && c.vendor === 'twilio') {
                    setSendSmsTestFor(c as TwilioSmsChannelDto);
                  } else if (c.type === 'sms' && c.vendor === 'messagebird') {
                    setSendMessageBirdTestFor(c as MessageBirdSmsChannelDto);
                  } else if (c.type === 'voice' && c.vendor === 'vapi') {
                    setPlaceVapiCallFor(c as VapiChannelDto);
                  } else if (c.type === 'voice' && c.vendor === 'threll') {
                    setPlaceThrellCallFor(c as ThrellChannelDto);
                  } else if (c.type === 'email') {
                    setSendTestFor(c as EmailChannelDto);
                  }
                }}
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
  alert,
  onActivate,
  onRotate,
  onRotateIdentity,
  onDelete,
  onShowEmbed,
  onEdit,
  onSendTest,
}: {
  channel: ChannelDto;
  alert: ChannelAlertDto | null;
  onActivate: () => void;
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
  const isTwilioSms = channel.type === 'sms' && channel.vendor === 'twilio';
  const isMessageBirdSms = channel.type === 'sms' && channel.vendor === 'messagebird';
  const isVapiVoice = channel.type === 'voice' && channel.vendor === 'vapi';
  const isThrellVoice = channel.type === 'voice' && channel.vendor === 'threll';
  const widgetConfig = isChat
    ? (channel.config as { originAllowlist?: string[] } | null)
    : null;
  const emailConfig = channel.type === 'email' ? (channel.config as EmailChannelDto['config']) : null;
  const smsConfig = isTwilioSms ? (channel.config as TwilioSmsChannelDto['config']) : null;
  const mbSmsConfig = isMessageBirdSms
    ? (channel.config as MessageBirdSmsChannelDto['config'])
    : null;
  const vapiConfig = isVapiVoice ? (channel.config as VapiChannelDto['config']) : null;
  const threllConfig = isThrellVoice ? (channel.config as ThrellChannelDto['config']) : null;
  const origins = widgetConfig?.originAllowlist ?? [];

  const badgeKind = channel.type;
  const badgeLabel = isChat
    ? t('typeChat')
    : isTwilioSms
      ? t('typeTwilioSms')
      : isMessageBirdSms
        ? t('typeMessageBirdSms')
        : isVapiVoice
          ? t('typeVapi')
          : isThrellVoice
            ? t('typeThrell')
            : channel.type === 'email'
              ? t('typeEmail')
              : channel.type;

  const isDeactivated = !channel.active;

  return (
    <li className="border-[0.5px] border-rule-soft dark:border-rule-on-dark bg-paper dark:bg-card px-5 py-4">
      <div className="flex items-start justify-between gap-6">
        <div className={cn('min-w-0 flex-1 space-y-3', isDeactivated && 'opacity-50')}>
          <div className="flex items-center gap-3 flex-wrap">
            <TypeBadge kind={badgeKind} label={badgeLabel} />
            <h3 className="font-serif text-lg leading-none text-ink dark:text-foreground">
              {channel.name}
            </h3>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {isChat ? (
              origins.length > 0 ? (
                origins.map((o) => <OriginChip key={o} text={o} />)
              ) : (
                <OriginChip text={t('anyOrigin')} muted />
              )
            ) : isTwilioSms ? (
              <>
                <VendorLogo vendor="twilio" className="size-4" />
                {smsConfig?.fromNumber && (
                  <span className="font-mono text-[11px] text-ink dark:text-foreground">
                    {smsConfig.fromNumber}
                  </span>
                )}
                {smsConfig?.messagingServiceSid && (
                  <OriginChip text={t('twilioSms.messagingService', { sid: smsConfig.messagingServiceSid })} />
                )}
                {smsConfig?.accountSid && (
                  <OriginChip text={t('twilioSms.accountSidChip', { sid: smsConfig.accountSid })} />
                )}
              </>
            ) : isMessageBirdSms ? (
              <>
                <VendorLogo vendor="messagebird" className="size-4" />
                {mbSmsConfig?.originator && (
                  <span className="font-mono text-[11px] text-ink dark:text-foreground">
                    {mbSmsConfig.originator}
                  </span>
                )}
              </>
            ) : isVapiVoice ? (
              <>
                <VendorLogo vendor="vapi" className="size-4" />
                {vapiConfig?.assistantId && (
                  <OriginChip text={t('vapi.assistantChip', { id: shortenId(vapiConfig.assistantId) })} />
                )}
                {vapiConfig?.phoneNumberId && (
                  <OriginChip text={t('vapi.phoneChip', { id: shortenId(vapiConfig.phoneNumberId) })} />
                )}
              </>
            ) : isThrellVoice ? (
              <>
                <VendorLogo vendor="threll" className="size-4" />
                {threllConfig?.accountId && (
                  <OriginChip text={t('threll.accountChip', { id: shortenId(threllConfig.accountId) })} />
                )}
                {threllConfig?.workerId && (
                  <OriginChip text={t('threll.workerChip', { id: shortenId(threllConfig.workerId) })} />
                )}
              </>
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
            ) : channel.type === 'email' || isTwilioSms || isMessageBirdSms || isVapiVoice || isThrellVoice ? (
              <Button variant="outline" size="sm" onClick={onEdit}>
                {tCommon('edit')}
              </Button>
            ) : null}
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
                      {t('rotateKey')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={onRotateIdentity}>
                      {t('rotateIdentity')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {channel.type === 'email' && (
                  <>
                    <DropdownMenuItem onClick={onSendTest}>
                      {t('sendTestEmail')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {isTwilioSms && (
                  <>
                    <DropdownMenuItem onClick={onSendTest}>
                      {t('twilioSms.sendTest')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {isMessageBirdSms && (
                  <>
                    <DropdownMenuItem onClick={onSendTest}>
                      {t('messageBirdSms.sendTest')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {isVapiVoice && (
                  <>
                    <DropdownMenuItem onClick={onSendTest}>
                      {t('vapi.placeCall')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {isThrellVoice && (
                  <>
                    <DropdownMenuItem onClick={onSendTest}>
                      {t('threll.placeCall')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem className="text-destructive" onClick={onDelete}>
                  {t('deleteChannel')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
      {alert && (
        <AlertFooter alert={alert} channel={channel} onActivate={onActivate} t={t} />
      )}
    </li>
  );
}

function AlertFooter({
  alert,
  channel,
  onActivate,
  t,
}: {
  alert: ChannelAlertDto;
  channel: ChannelDto;
  onActivate: () => void;
  t: ReturnType<typeof useTranslations<'dashboard.channels'>>;
}) {
  const isDeactivated = !channel.active;
  const attempt = alert.metadata.attemptCount ?? 1;
  const threshold = alert.metadata.threshold ?? 5;
  const dotClass = isDeactivated ? 'bg-destructive' : 'bg-amber-500';
  const message = isDeactivated
    ? t('status.deactivatedMessage', { threshold })
    : t('status.failingMessage', { attempt, threshold });
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t-[0.5px] border-rule-soft pt-3 dark:border-rule-on-dark">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span className={cn('size-[7px] shrink-0 rounded-full', dotClass)} aria-hidden />
        <span className="truncate text-[13px] text-ink dark:text-foreground">{message}</span>
        {alert.detail && (
          <span className="hidden truncate font-mono text-[11px] text-ink-mute md:inline">
            · {alert.detail}
          </span>
        )}
      </div>
      {isDeactivated && (
        <Button size="sm" onClick={onActivate}>
          {t('status.activate')}
        </Button>
      )}
    </div>
  );
}

function TypeBadge({ kind, label }: { kind: 'chat' | 'email' | 'voice' | 'sms'; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 font-mono text-[10px] uppercase tracking-eyebrow rounded',
        kind === 'chat'
          ? 'bg-cobalt/15 text-cobalt-deep dark:bg-cobalt-soft/20 dark:text-cobalt-soft'
          : kind === 'sms'
            ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100'
            : kind === 'voice'
              ? 'bg-violet-100 text-violet-900 dark:bg-violet-900/30 dark:text-violet-100'
              : 'bg-auth-navy/15 text-auth-navy dark:bg-auth-navy/30 dark:text-paper',
      )}
    >
      {label}
    </span>
  );
}

type ChannelVendor = 'twilio' | 'messagebird' | 'vapi' | 'threll';

function VendorLogo({
  vendor,
  className,
}: {
  vendor: ChannelVendor;
  className?: string;
}) {
  const Logo =
    vendor === 'twilio'
      ? TwilioLogo
      : vendor === 'messagebird'
        ? MessageBirdLogo
        : vendor === 'threll'
          ? ThrellLogo
          : VapiLogo;
  const colorClass =
    vendor === 'twilio'
      ? ''
      : 'text-ink dark:text-foreground';
  return <Logo className={cn('shrink-0', colorClass, className)} />;
}

interface VendorPickerOption<V extends string> {
  id: V;
  label: string;
}

function VendorPicker<V extends ChannelVendor>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<VendorPickerOption<V>>;
  value: V;
  onChange: (next: V) => void;
}) {
  return (
    <div className="flex border-[0.5px] border-ink dark:border-foreground">
      {options.map((opt) => {
        const selected = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            aria-pressed={selected}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 border-r-[0.5px] border-rule-soft px-3 py-2 text-sm transition-colors last:border-r-0',
              selected
                ? 'bg-cobalt/5 text-ink dark:text-foreground'
                : 'text-muted-foreground hover:text-ink dark:hover:text-foreground',
            )}
          >
            <VendorLogo vendor={opt.id} className="size-4" />
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function shortenId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
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
    if (widgetAllowlistRequired() && allowlist.length === 0) {
      setOriginsError(t('originsRequired'));
      return;
    }
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
      const result = await api<CreatedWidget>('/v1/conversations/channels/widget', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      setCreated(result);
      onCreated();
    } catch (err) {
      setSubmitError(
        toSaveErrorDetail(err, translate(err) || t('errors.create'), {
          endpoint: '/v1/conversations/channels/widget',
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

function widgetAllowlistRequired(): boolean {
  const raw = process.env.NEXT_PUBLIC_WIDGET_REQUIRE_ALLOWLIST?.trim().toLowerCase();
  return raw === '1' || raw === 'true';
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
      await api('/v1/conversations/channels/email', {
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
            endpoint: '/v1/conversations/channels/email',
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
              <div className="space-y-2 border-t border-rule-soft pt-3 sm:col-span-2">
                <div className="text-sm font-medium">{t('email.sendLimitsLabel')}</div>
                <p className="text-xs text-muted-foreground">{t('email.sendLimitsHelp')}</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              </div>
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
      await api(`/v1/conversations/channels/email/${channel.id}/send-test`, {
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

function generateWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function WebhookSecretField({
  value,
  onChange,
  generateLabel,
  regenerateLabel,
  emptyHint,
}: {
  value: string;
  onChange: (next: string) => void;
  generateLabel: string;
  regenerateLabel: string;
  emptyHint?: string;
}) {
  const tCommon = useTranslations('common');
  const [copied, setCopied] = useState(false);
  function copy() {
    if (!value) return;
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), KEY_DISPLAY_TIMEOUT_MS);
    });
  }
  function regenerate() {
    onChange(generateWebhookSecret());
    setCopied(false);
  }
  return (
    <div className="flex flex-col gap-2">
      {value ? (
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-md border-[0.5px] bg-background px-3 py-2 font-mono text-sm">
            {value}
          </code>
          <Button type="button" variant="outline" size="sm" onClick={copy}>
            <Copy className="size-4" />
            {copied ? tCommon('copied') : tCommon('copy')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={regenerate}>
            <RefreshCw className="size-4" />
            {regenerateLabel}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="flex-1 truncate rounded-md border-[0.5px] border-dashed bg-background px-3 py-2 font-mono text-sm text-muted-foreground">
            {emptyHint ?? '••••'}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={regenerate}>
            <RefreshCw className="size-4" />
            {generateLabel}
          </Button>
        </div>
      )}
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
  .update(externalId) // your stable user id
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

function TwilioSmsChannelDialog({
  open,
  onOpenChange,
  onSaved,
  editChannel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  editChannel: TwilioSmsChannelDto;
}) {
  const t = useTranslations('dashboard.channels');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const [name, setName] = useState(editChannel.name);
  const [accountSid, setAccountSid] = useState(editChannel.config?.accountSid ?? '');
  const [authToken, setAuthToken] = useState('');
  const [fromNumber, setFromNumber] = useState(editChannel.config?.fromNumber ?? '');
  const [messagingServiceSid, setMessagingServiceSid] = useState(
    editChannel.config?.messagingServiceSid ?? '',
  );
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<SaveErrorDetail | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setName(editChannel.name);
    setAccountSid(editChannel.config?.accountSid ?? '');
    setAuthToken('');
    setFromNumber(editChannel.config?.fromNumber ?? '');
    setMessagingServiceSid(editChannel.config?.messagingServiceSid ?? '');
    setSubmitError(null);
    setFieldErrors({});
    setSaving(false);
  }, [open, editChannel]);

  async function submit() {
    const payload: Record<string, unknown> = {
      channelId: editChannel.id,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(accountSid.trim() ? { accountSid: accountSid.trim() } : {}),
      ...(authToken ? { authToken } : {}),
      ...(fromNumber.trim() ? { fromNumber: fromNumber.trim() } : {}),
      ...(messagingServiceSid.trim() ? { messagingServiceSid: messagingServiceSid.trim() } : {}),
    };
    const parsed = ConfigureTwilioSmsBody.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(zodIssuesToFieldErrors(parsed.error.issues, t));
      return;
    }
    setFieldErrors({});
    setSaving(true);
    setSubmitError(null);
    try {
      await api('/v1/conversations/channels/twilio-sms', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setSubmitError(
        toSaveErrorDetail(err, translate(err) || t('errors.updateTwilioSms'), {
          endpoint: '/v1/conversations/channels/twilio-sms',
          method: 'POST',
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {submitError ? (
          <SaveErrorStage
            detail={submitError}
            onBack={() => setSubmitError(null)}
            onRetry={() => void submit()}
            retrying={saving}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('twilioSms.editTitle')}</DialogTitle>
              <DialogDescription>{t('twilioSms.editDescription')}</DialogDescription>
            </DialogHeader>
            <form
              className="mt-4 flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <FormField label={t('nameLabel')} hint={t('twilioSms.nameHint')}>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. main-twilio"
                  maxLength={120}
                />
              </FormField>
              <FormField
                label={t('twilioSms.accountSidLabel')}
                hint={t('twilioSms.accountSidHint')}
                error={fieldErrors.accountSid}
              >
                <Input
                  value={accountSid}
                  onChange={(e) => setAccountSid(e.target.value)}
                  placeholder="AC…"
                  autoComplete="off"
                />
              </FormField>
              <FormField
                label={t('twilioSms.authTokenLabel')}
                hint={t('twilioSms.authTokenHintEdit')}
              >
                <Input
                  type="password"
                  value={authToken}
                  onChange={(e) => setAuthToken(e.target.value)}
                  placeholder="••••"
                  autoComplete="off"
                />
              </FormField>
              <FormField
                label={t('twilioSms.fromNumberLabel')}
                hint={t('twilioSms.fromNumberHint')}
                error={fieldErrors.fromNumber}
              >
                <Input
                  value={fromNumber}
                  onChange={(e) => setFromNumber(e.target.value)}
                  placeholder="+15551234567"
                  maxLength={32}
                />
              </FormField>
              <FormField
                label={t('twilioSms.messagingServiceSidLabel')}
                hint={t('twilioSms.messagingServiceSidHint')}
                error={fieldErrors.messagingServiceSid}
              >
                <Input
                  value={messagingServiceSid}
                  onChange={(e) => setMessagingServiceSid(e.target.value)}
                  placeholder="MG…"
                  maxLength={64}
                />
              </FormField>
              <p className={dialogHintClass}>{t('twilioSms.fromOrServiceHint')}</p>
              <DialogFooter className={dialogFooterClass}>
                <Button
                  type="button"
                  variant="outline"
                  className={dialogButtonClass}
                  onClick={() => onOpenChange(false)}
                  disabled={saving}
                >
                  {tCommon('cancel')}
                </Button>
                <Button
                  type="submit"
                  variant="accent"
                  className={dialogButtonClass}
                  disabled={saving}
                  pending={saving}
                >
                  {saving ? tCommon('saving') : tCommon('saveChanges')}
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

function SendTestSmsDialog({
  channel,
  onClose,
}: {
  channel: TwilioSmsChannelDto;
  onClose: () => void;
}) {
  const t = useTranslations('dashboard.channels');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const [to, setTo] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit() {
    const trimmed = to.trim();
    if (!trimmed) return;
    const payload: Record<string, unknown> = { to: trimmed };
    if (body.trim()) payload.body = body.trim();
    const parsed = SendTwilioSmsTestBody.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'invalid input');
      return;
    }
    setSending(true);
    setError(null);
    try {
      await api(`/v1/conversations/channels/twilio-sms/${channel.id}/send-test`, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      notify.success(t('twilioSms.sendTestDialog.success', { to: trimmed }));
      onClose();
    } catch (err) {
      setError(translate(err) || t('errors.sendTestSms'));
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('twilioSms.sendTestDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('twilioSms.sendTestDialog.description', { name: channel.name })}
          </DialogDescription>
        </DialogHeader>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <FormField
            label={t('twilioSms.sendTestDialog.toLabel')}
            hint={t('twilioSms.sendTestDialog.toHint')}
            error={error ?? undefined}
          >
            <Input
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                if (error) setError(null);
              }}
              required
              autoFocus
              placeholder="+15551234567"
              aria-invalid={error ? true : undefined}
            />
          </FormField>
          <FormField
            label={t('twilioSms.sendTestDialog.bodyLabel')}
            hint={t('twilioSms.sendTestDialog.bodyHint')}
          >
            <Input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={1600}
              placeholder={t('twilioSms.sendTestDialog.bodyPlaceholder')}
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
              {sending
                ? t('twilioSms.sendTestDialog.sending')
                : t('twilioSms.sendTestDialog.submit')}
              <span aria-hidden className="ml-1 font-mono">↵</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MessageBirdSmsChannelDialog({
  open,
  onOpenChange,
  onSaved,
  editChannel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  editChannel: MessageBirdSmsChannelDto;
}) {
  const t = useTranslations('dashboard.channels');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const [name, setName] = useState(editChannel.name);
  const [accessKey, setAccessKey] = useState('');
  const [signingKey, setSigningKey] = useState('');
  const [originator, setOriginator] = useState(editChannel.config?.originator ?? '');
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<SaveErrorDetail | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setName(editChannel.name);
    setAccessKey('');
    setSigningKey('');
    setOriginator(editChannel.config?.originator ?? '');
    setSubmitError(null);
    setFieldErrors({});
    setSaving(false);
  }, [open, editChannel]);

  async function submit() {
    const payload: Record<string, unknown> = {
      channelId: editChannel.id,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(accessKey ? { accessKey } : {}),
      ...(signingKey ? { signingKey } : {}),
      ...(originator.trim() ? { originator: originator.trim() } : {}),
    };
    const parsed = ConfigureMessageBirdSmsBody.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(zodIssuesToFieldErrors(parsed.error.issues, t));
      return;
    }
    setFieldErrors({});
    setSaving(true);
    setSubmitError(null);
    try {
      await api('/v1/conversations/channels/messagebird-sms', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setSubmitError(
        toSaveErrorDetail(err, translate(err) || t('errors.updateMessageBirdSms'), {
          endpoint: '/v1/conversations/channels/messagebird-sms',
          method: 'POST',
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {submitError ? (
          <SaveErrorStage
            detail={submitError}
            onBack={() => setSubmitError(null)}
            onRetry={() => void submit()}
            retrying={saving}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('messageBirdSms.editTitle')}</DialogTitle>
              <DialogDescription>{t('messageBirdSms.editDescription')}</DialogDescription>
            </DialogHeader>
            <form
              className="mt-4 flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <FormField label={t('nameLabel')} hint={t('messageBirdSms.nameHint')}>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. nordic-messagebird"
                  maxLength={120}
                />
              </FormField>
              <FormField
                label={t('messageBirdSms.accessKeyLabel')}
                hint={t('messageBirdSms.accessKeyHintEdit')}
              >
                <Input
                  type="password"
                  value={accessKey}
                  onChange={(e) => setAccessKey(e.target.value)}
                  placeholder="••••"
                  autoComplete="off"
                />
              </FormField>
              <FormField
                label={t('messageBirdSms.signingKeyLabel')}
                hint={t('messageBirdSms.signingKeyHintEdit')}
              >
                <Input
                  type="password"
                  value={signingKey}
                  onChange={(e) => setSigningKey(e.target.value)}
                  placeholder="••••"
                  autoComplete="off"
                />
              </FormField>
              <FormField
                label={t('messageBirdSms.originatorLabel')}
                hint={t('messageBirdSms.originatorHint')}
                error={fieldErrors.originator}
              >
                <Input
                  value={originator}
                  onChange={(e) => setOriginator(e.target.value)}
                  placeholder="+15551234567 or AcmeSupport"
                  maxLength={32}
                />
              </FormField>
              <DialogFooter className={dialogFooterClass}>
                <Button
                  type="button"
                  variant="outline"
                  className={dialogButtonClass}
                  onClick={() => onOpenChange(false)}
                  disabled={saving}
                >
                  {tCommon('cancel')}
                </Button>
                <Button
                  type="submit"
                  variant="accent"
                  className={dialogButtonClass}
                  disabled={saving}
                  pending={saving}
                >
                  {saving ? tCommon('saving') : tCommon('saveChanges')}
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

function SendTestMessageBirdSmsDialog({
  channel,
  onClose,
}: {
  channel: MessageBirdSmsChannelDto;
  onClose: () => void;
}) {
  const t = useTranslations('dashboard.channels');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const [to, setTo] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit() {
    const trimmed = to.trim();
    if (!trimmed) return;
    const payload: Record<string, unknown> = { to: trimmed };
    if (body.trim()) payload.body = body.trim();
    const parsed = SendMessageBirdSmsTestBody.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'invalid input');
      return;
    }
    setSending(true);
    setError(null);
    try {
      await api(`/v1/conversations/channels/messagebird-sms/${channel.id}/send-test`, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      notify.success(t('messageBirdSms.sendTestDialog.success', { to: trimmed }));
      onClose();
    } catch (err) {
      setError(translate(err) || t('errors.sendTestMessageBirdSms'));
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('messageBirdSms.sendTestDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('messageBirdSms.sendTestDialog.description', { name: channel.name })}
          </DialogDescription>
        </DialogHeader>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <FormField
            label={t('messageBirdSms.sendTestDialog.toLabel')}
            hint={t('messageBirdSms.sendTestDialog.toHint')}
            error={error ?? undefined}
          >
            <Input
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                if (error) setError(null);
              }}
              required
              autoFocus
              placeholder="+15551234567"
              aria-invalid={error ? true : undefined}
            />
          </FormField>
          <FormField
            label={t('messageBirdSms.sendTestDialog.bodyLabel')}
            hint={t('messageBirdSms.sendTestDialog.bodyHint')}
          >
            <Input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={1600}
              placeholder={t('messageBirdSms.sendTestDialog.bodyPlaceholder')}
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
              {sending
                ? t('messageBirdSms.sendTestDialog.sending')
                : t('messageBirdSms.sendTestDialog.submit')}
              <span aria-hidden className="ml-1 font-mono">↵</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type SmsVendor = 'twilio' | 'messagebird';

function AddSmsDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const t = useTranslations('dashboard.channels');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const [vendor, setVendor] = useState<SmsVendor>('twilio');
  const [name, setName] = useState('');
  const [accountSid, setAccountSid] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [fromNumber, setFromNumber] = useState('');
  const [messagingServiceSid, setMessagingServiceSid] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [signingKey, setSigningKey] = useState('');
  const [originator, setOriginator] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<SaveErrorDetail | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setVendor('twilio');
    setName('');
    setAccountSid('');
    setAuthToken('');
    setFromNumber('');
    setMessagingServiceSid('');
    setAccessKey('');
    setSigningKey('');
    setOriginator('');
    setSubmitError(null);
    setFieldErrors({});
    setSaving(false);
  }, [open]);

  async function submitTwilio(): Promise<void> {
    const payload: Record<string, unknown> = {
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(accountSid.trim() ? { accountSid: accountSid.trim() } : {}),
      ...(authToken ? { authToken } : {}),
      ...(fromNumber.trim() ? { fromNumber: fromNumber.trim() } : {}),
      ...(messagingServiceSid.trim() ? { messagingServiceSid: messagingServiceSid.trim() } : {}),
    };
    const parsed = ConfigureTwilioSmsBody.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(zodIssuesToFieldErrors(parsed.error.issues, t));
      return;
    }
    setFieldErrors({});
    setSaving(true);
    setSubmitError(null);
    try {
      await api('/v1/conversations/channels/twilio-sms', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setSubmitError(
        toSaveErrorDetail(err, translate(err) || t('errors.createTwilioSms'), {
          endpoint: '/v1/conversations/channels/twilio-sms',
          method: 'POST',
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  async function submitMessageBird(): Promise<void> {
    const payload: Record<string, unknown> = {
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(accessKey ? { accessKey } : {}),
      ...(signingKey ? { signingKey } : {}),
      ...(originator.trim() ? { originator: originator.trim() } : {}),
    };
    const parsed = ConfigureMessageBirdSmsBody.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(zodIssuesToFieldErrors(parsed.error.issues, t));
      return;
    }
    setFieldErrors({});
    setSaving(true);
    setSubmitError(null);
    try {
      await api('/v1/conversations/channels/messagebird-sms', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setSubmitError(
        toSaveErrorDetail(err, translate(err) || t('errors.createMessageBirdSms'), {
          endpoint: '/v1/conversations/channels/messagebird-sms',
          method: 'POST',
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  function submit(): void {
    setFieldErrors({});
    if (vendor === 'twilio') void submitTwilio();
    else void submitMessageBird();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {submitError ? (
          <SaveErrorStage
            detail={submitError}
            onBack={() => setSubmitError(null)}
            onRetry={() => submit()}
            retrying={saving}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('addSmsDialog.title')}</DialogTitle>
              <DialogDescription>{t('addSmsDialog.description')}</DialogDescription>
            </DialogHeader>
            <form
              className="mt-4 flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <VendorPicker
                options={[
                  { id: 'twilio', label: t('typeTwilioSms') },
                  { id: 'messagebird', label: t('typeMessageBirdSms') },
                ]}
                value={vendor}
                onChange={(next) => setVendor(next)}
              />
              {vendor === 'twilio' ? (
                <>
                  <FormField label={t('nameLabel')} hint={t('twilioSms.nameHint')}>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. main-twilio"
                      maxLength={120}
                      required
                    />
                  </FormField>
                  <FormField
                    label={t('twilioSms.accountSidLabel')}
                    hint={t('twilioSms.accountSidHint')}
                    error={fieldErrors.accountSid}
                  >
                    <Input
                      value={accountSid}
                      onChange={(e) => setAccountSid(e.target.value)}
                      placeholder="AC…"
                      autoComplete="off"
                      required
                    />
                  </FormField>
                  <FormField
                    label={t('twilioSms.authTokenLabel')}
                    hint={t('twilioSms.authTokenHintCreate')}
                  >
                    <Input
                      type="password"
                      value={authToken}
                      onChange={(e) => setAuthToken(e.target.value)}
                      autoComplete="off"
                      required
                    />
                  </FormField>
                  <FormField
                    label={t('twilioSms.fromNumberLabel')}
                    hint={t('twilioSms.fromNumberHint')}
                    error={fieldErrors.fromNumber}
                  >
                    <Input
                      value={fromNumber}
                      onChange={(e) => setFromNumber(e.target.value)}
                      placeholder="+15551234567"
                      maxLength={32}
                    />
                  </FormField>
                  <FormField
                    label={t('twilioSms.messagingServiceSidLabel')}
                    hint={t('twilioSms.messagingServiceSidHint')}
                    error={fieldErrors.messagingServiceSid}
                  >
                    <Input
                      value={messagingServiceSid}
                      onChange={(e) => setMessagingServiceSid(e.target.value)}
                      placeholder="MG…"
                      maxLength={64}
                    />
                  </FormField>
                  <p className={dialogHintClass}>{t('twilioSms.fromOrServiceHint')}</p>
                </>
              ) : (
                <>
                  <FormField label={t('nameLabel')} hint={t('messageBirdSms.nameHint')}>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. nordic-messagebird"
                      maxLength={120}
                      required
                    />
                  </FormField>
                  <FormField
                    label={t('messageBirdSms.accessKeyLabel')}
                    hint={t('messageBirdSms.accessKeyHintCreate')}
                  >
                    <Input
                      type="password"
                      value={accessKey}
                      onChange={(e) => setAccessKey(e.target.value)}
                      autoComplete="off"
                      required
                    />
                  </FormField>
                  <FormField
                    label={t('messageBirdSms.signingKeyLabel')}
                    hint={t('messageBirdSms.signingKeyHintCreate')}
                  >
                    <Input
                      type="password"
                      value={signingKey}
                      onChange={(e) => setSigningKey(e.target.value)}
                      autoComplete="off"
                      required
                    />
                  </FormField>
                  <FormField
                    label={t('messageBirdSms.originatorLabel')}
                    hint={t('messageBirdSms.originatorHint')}
                    error={fieldErrors.originator}
                  >
                    <Input
                      value={originator}
                      onChange={(e) => setOriginator(e.target.value)}
                      placeholder="+15551234567 or AcmeSupport"
                      maxLength={32}
                      required
                    />
                  </FormField>
                </>
              )}
              <DialogFooter className={dialogFooterClass}>
                <Button
                  type="button"
                  variant="outline"
                  className={dialogButtonClass}
                  onClick={() => onOpenChange(false)}
                  disabled={saving}
                >
                  {tCommon('cancel')}
                </Button>
                <Button
                  type="submit"
                  variant="accent"
                  className={dialogButtonClass}
                  disabled={saving}
                  pending={saving}
                >
                  {saving ? tCommon('creating') : t('addSmsDialog.create')}
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

type VoiceVendor = 'vapi' | 'threll';

function AddVoiceDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const t = useTranslations('dashboard.channels');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const confirm = useConfirm();
  const [vendor, setVendor] = useState<VoiceVendor>('threll');
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [assistantId, setAssistantId] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [stage, setStage] = useState<'form' | 'options'>('form');
  const [options, setOptions] = useState<ChannelOptionItem[]>([]);
  const [optionsAccountLabel, setOptionsAccountLabel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<SaveErrorDetail | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [createdChannelId, setCreatedChannelId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setVendor('threll');
    setName('');
    setApiKey('');
    setWebhookSecret('');
    setAssistantId('');
    setPhoneNumberId('');
    setPublicKey('');
    setWorkerId('');
    setStage('form');
    setOptions([]);
    setOptionsAccountLabel(null);
    setSubmitError(null);
    setFieldErrors({});
    setSaving(false);
    setCreatedChannelId(null);
  }, [open]);

  async function fetchVapiAssistants(): Promise<void> {
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = t('errors.required');
    if (!apiKey) errors.apiKey = t('errors.required');
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setSaving(true);
    setSubmitError(null);
    try {
      const res = await api<ChannelOptionsResponse>('/v1/conversations/channels/options', {
        method: 'POST',
        body: JSON.stringify({ vendor: 'vapi', config: { apiKey } }),
      });
      const assistants = channelOptionsFor(res, 'assistants');
      setOptions(assistants);
      setOptionsAccountLabel(null);
      setAssistantId(assistants[0]?.value ?? '');
      setStage('options');
    } catch (err) {
      setSubmitError(
        toSaveErrorDetail(err, translate(err) || t('errors.createVapi'), {
          endpoint: '/v1/conversations/channels/options',
          method: 'POST',
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  async function submitVapi(replaceWebhook = false): Promise<void> {
    const generatedSecret = generateWebhookSecret();
    const payload: Record<string, unknown> = {
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(apiKey ? { apiKey } : {}),
      webhookSecret: generatedSecret,
      ...(assistantId.trim() ? { assistantId: assistantId.trim() } : {}),
      ...(phoneNumberId.trim() ? { phoneNumberId: phoneNumberId.trim() } : {}),
      ...(publicKey.trim() ? { publicKey: publicKey.trim() } : {}),
      ...(replaceWebhook ? { replaceWebhook: true } : {}),
    };
    const parsed = ConfigureVapiBody.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(zodIssuesToFieldErrors(parsed.error.issues, t));
      return;
    }
    setFieldErrors({});
    setSaving(true);
    setSubmitError(null);
    try {
      const created = await api<{ id: string; webhookConfigured?: boolean }>(
        '/v1/conversations/channels/vapi',
        {
          method: 'POST',
          body: JSON.stringify(parsed.data),
        },
      );
      onSaved();
      if (created.webhookConfigured) {
        onOpenChange(false);
      } else {
        setWebhookSecret(generatedSecret);
        setCreatedChannelId(created.id);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'webhook_conflict') {
        setSaving(false);
        const ok = await confirm({
          title: t('vapi.replaceWebhook.title'),
          message: t('vapi.replaceWebhook.message'),
          confirmLabel: t('vapi.replaceWebhook.confirm'),
          cancelLabel: tCommon('cancel'),
          destructive: true,
        });
        if (ok) await submitVapi(true);
        return;
      }
      setSubmitError(
        toSaveErrorDetail(err, translate(err) || t('errors.createVapi'), {
          endpoint: '/v1/conversations/channels/vapi',
          method: 'POST',
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  async function fetchThrellWorkers(): Promise<void> {
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = t('errors.required');
    if (!apiKey) errors.apiKey = t('errors.required');
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setSaving(true);
    setSubmitError(null);
    try {
      const res = await api<ChannelOptionsResponse>('/v1/conversations/channels/options', {
        method: 'POST',
        body: JSON.stringify({ vendor: 'threll', config: { apiKey } }),
      });
      const workers = channelOptionsFor(res, 'workers');
      setOptions(workers);
      setOptionsAccountLabel(res.context?.label ?? null);
      setWorkerId(workers[0]?.value ?? '');
      setStage('options');
    } catch (err) {
      setSubmitError(
        toSaveErrorDetail(err, translate(err) || t('errors.createThrell'), {
          endpoint: '/v1/conversations/channels/options',
          method: 'POST',
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  async function createThrell(replaceWebhook = false): Promise<void> {
    const payload = {
      name: name.trim(),
      apiKey,
      workerId,
      ...(replaceWebhook ? { replaceWebhook: true } : {}),
    };
    const parsed = ConfigureThrellBody.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(zodIssuesToFieldErrors(parsed.error.issues, t));
      return;
    }
    setSaving(true);
    setSubmitError(null);
    try {
      await api<{ id: string }>('/v1/conversations/channels/threll', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'webhook_conflict') {
        setSaving(false);
        const ok = await confirm({
          title: t('threll.replaceWebhook.title'),
          message: t('threll.replaceWebhook.message'),
          confirmLabel: t('threll.replaceWebhook.confirm'),
          cancelLabel: tCommon('cancel'),
          destructive: true,
        });
        if (ok) await createThrell(true);
        return;
      }
      setSubmitError(
        toSaveErrorDetail(err, translate(err) || t('errors.createThrell'), {
          endpoint: '/v1/conversations/channels/threll',
          method: 'POST',
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  function submit(): void {
    setFieldErrors({});
    if (vendor === 'vapi') void fetchVapiAssistants();
    else if (vendor === 'threll') void fetchThrellWorkers();
  }

  function createForVendor(): void {
    if (vendor === 'vapi') void submitVapi();
    else void createThrell();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {submitError ? (
          <SaveErrorStage
            detail={submitError}
            onBack={() => setSubmitError(null)}
            onRetry={() => (stage === 'options' ? createForVendor() : submit())}
            retrying={saving}
          />
        ) : createdChannelId ? (
          <VapiConnectionStage
            channelId={createdChannelId}
            webhookSecret={webhookSecret}
            onDone={() => onOpenChange(false)}
          />
        ) : stage === 'options' ? (
          <ChannelOptionStage
            title={vendor === 'threll' ? t('threll.workerStage.title') : t('vapi.assistantStage.title')}
            description={
              vendor === 'threll'
                ? optionsAccountLabel
                  ? t('threll.workerStage.descriptionAccount', { account: optionsAccountLabel })
                  : t('threll.workerStage.description')
                : t('vapi.assistantStage.description')
            }
            fieldLabel={vendor === 'threll' ? t('threll.workerLabel') : t('vapi.assistantIdLabel')}
            fieldHint={vendor === 'threll' ? t('threll.workerHint') : t('vapi.assistantIdHint')}
            emptyMessage={
              vendor === 'threll' ? t('threll.workerStage.empty') : t('vapi.assistantStage.empty')
            }
            options={options}
            value={vendor === 'threll' ? workerId : assistantId}
            onChange={vendor === 'threll' ? setWorkerId : setAssistantId}
            saving={saving}
            onBack={() => setStage('form')}
            onCreate={createForVendor}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('addVoiceDialog.title')}</DialogTitle>
              <DialogDescription>{t('addVoiceDialog.description')}</DialogDescription>
            </DialogHeader>
            <form
              className="mt-4 flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <VendorPicker
                options={[
                  { id: 'threll', label: t('typeThrell') },
                  { id: 'vapi', label: t('typeVapi') },
                ]}
                value={vendor}
                onChange={(next) => setVendor(next)}
              />
              {vendor === 'vapi' ? (
                <>
                  <FormField label={t('nameLabel')} hint={t('vapi.nameHint')}>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. main-vapi"
                      maxLength={120}
                      required
                    />
                  </FormField>
                  <FormField label={t('vapi.apiKeyLabel')} hint={t('vapi.apiKeyHintCreate')}>
                    <Input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      autoComplete="off"
                      required
                    />
                  </FormField>
                  <FormField
                    label={t('vapi.publicKeyLabel')}
                    hint={t('vapi.publicKeyHintCreate')}
                    error={fieldErrors.publicKey}
                  >
                    <Input
                      value={publicKey}
                      onChange={(e) => setPublicKey(e.target.value)}
                      maxLength={256}
                      autoComplete="off"
                    />
                  </FormField>
                  <FormField
                    label={t('vapi.phoneNumberIdLabel')}
                    hint={t('vapi.phoneNumberIdHint')}
                    error={fieldErrors.phoneNumberId}
                  >
                    <Input
                      value={phoneNumberId}
                      onChange={(e) => setPhoneNumberId(e.target.value)}
                      maxLength={128}
                    />
                  </FormField>
                </>
              ) : (
                <>
                  <FormField label={t('nameLabel')} hint={t('threll.nameHint')}>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. main-threll"
                      maxLength={120}
                      required
                    />
                  </FormField>
                  <FormField label={t('threll.apiKeyLabel')} hint={t('threll.apiKeyHintCreate')}>
                    <Input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      autoComplete="off"
                      required
                    />
                  </FormField>
                </>
              )}
              <DialogFooter className={dialogFooterClass}>
                <Button
                  type="button"
                  variant="outline"
                  className={dialogButtonClass}
                  onClick={() => onOpenChange(false)}
                  disabled={saving}
                >
                  {tCommon('cancel')}
                </Button>
                <Button
                  type="submit"
                  variant="accent"
                  className={dialogButtonClass}
                  disabled={saving}
                  pending={saving}
                >
                  {saving ? tCommon('creating') : tCommon('continue')}
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

function vapiWebhookUrl(channelId: string): string {
  const host = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
  return `${host}/v1/conversations/channels/${channelId}/webhook`;
}

function VapiConnectionStage({
  channelId,
  webhookSecret,
  onDone,
}: {
  channelId: string;
  webhookSecret: string;
  onDone: () => void;
}) {
  const t = useTranslations('dashboard.channels');
  const tCommon = useTranslations('common');
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('vapi.connectionStage.title')}</DialogTitle>
        <DialogDescription>{t('vapi.connectionStage.description')}</DialogDescription>
      </DialogHeader>
      <div className="mt-2 flex flex-col gap-4">
        <CopyableSecret
          label={t('vapi.connectionStage.serverUrlLabel')}
          value={vapiWebhookUrl(channelId)}
          hint={t('vapi.connectionStage.serverUrlHint')}
        />
        <CopyableSecret
          label={t('vapi.connectionStage.webhookSecretLabel')}
          value={webhookSecret}
          hint={t('vapi.connectionStage.webhookSecretHint')}
        />
      </div>
      <DialogFooter className={dialogFooterClass}>
        <Button variant="accent" className={dialogButtonClass} onClick={onDone}>
          {tCommon('done')}
        </Button>
      </DialogFooter>
    </>
  );
}

function VapiChannelDialog({
  open,
  onOpenChange,
  onSaved,
  editChannel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  editChannel: VapiChannelDto;
}) {
  const t = useTranslations('dashboard.channels');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const [name, setName] = useState(editChannel.name);
  const [apiKey, setApiKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [assistantId, setAssistantId] = useState(editChannel.config?.assistantId ?? '');
  const [phoneNumberId, setPhoneNumberId] = useState(editChannel.config?.phoneNumberId ?? '');
  const [publicKey, setPublicKey] = useState(editChannel.config?.publicKey ?? '');
  const [assistants, setAssistants] = useState<ChannelOptionItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<SaveErrorDetail | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setName(editChannel.name);
    setApiKey('');
    setWebhookSecret('');
    setAssistantId(editChannel.config?.assistantId ?? '');
    setPhoneNumberId(editChannel.config?.phoneNumberId ?? '');
    setPublicKey(editChannel.config?.publicKey ?? '');
    setAssistants([]);
    setSubmitError(null);
    setFieldErrors({});
    setSaving(false);
    let cancelled = false;
    void api<ChannelOptionsResponse>(`/v1/conversations/channels/${editChannel.id}/options`, {
      method: 'POST',
    })
      .then((res) => {
        if (!cancelled) setAssistants(channelOptionsFor(res, 'assistants'));
      })
      .catch(() => {
        if (!cancelled) setAssistants([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, editChannel]);

  async function submit() {
    const payload: Record<string, unknown> = {
      channelId: editChannel.id,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(apiKey ? { apiKey } : {}),
      ...(webhookSecret ? { webhookSecret } : {}),
      ...(assistantId.trim() ? { assistantId: assistantId.trim() } : {}),
      ...(phoneNumberId.trim() ? { phoneNumberId: phoneNumberId.trim() } : {}),
      ...(publicKey.trim() ? { publicKey: publicKey.trim() } : {}),
    };
    const parsed = ConfigureVapiBody.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(zodIssuesToFieldErrors(parsed.error.issues, t));
      return;
    }
    setFieldErrors({});
    setSaving(true);
    setSubmitError(null);
    try {
      await api('/v1/conversations/channels/vapi', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setSubmitError(
        toSaveErrorDetail(err, translate(err) || t('errors.updateVapi'), {
          endpoint: '/v1/conversations/channels/vapi',
          method: 'POST',
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {submitError ? (
          <SaveErrorStage
            detail={submitError}
            onBack={() => setSubmitError(null)}
            onRetry={() => void submit()}
            retrying={saving}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('vapi.editTitle')}</DialogTitle>
              <DialogDescription>{t('vapi.editDescription')}</DialogDescription>
            </DialogHeader>
            <form
              className="mt-4 flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <FormField label={t('nameLabel')} hint={t('vapi.nameHint')}>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. main-vapi"
                  maxLength={120}
                />
              </FormField>
              <FormField label={t('vapi.apiKeyLabel')} hint={t('vapi.apiKeyHintEdit')}>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="••••"
                  autoComplete="off"
                />
              </FormField>
              <FormField
                label={t('vapi.publicKeyLabel')}
                hint={t('vapi.publicKeyHintEdit')}
                error={fieldErrors.publicKey}
              >
                <Input
                  value={publicKey}
                  onChange={(e) => setPublicKey(e.target.value)}
                  maxLength={256}
                  autoComplete="off"
                />
              </FormField>
              <FormField label={t('vapi.webhookSecretLabel')} hint={t('vapi.webhookSecretHintEdit')}>
                <WebhookSecretField
                  value={webhookSecret}
                  onChange={setWebhookSecret}
                  generateLabel={t('vapi.webhookSecretGenerate')}
                  regenerateLabel={t('vapi.webhookSecretRegenerate')}
                  emptyHint={t('vapi.webhookSecretKeepHint')}
                />
              </FormField>
              <FormField
                label={t('vapi.assistantIdLabel')}
                hint={t('vapi.assistantIdHint')}
                error={fieldErrors.assistantId}
              >
                {assistants.length > 0 ? (
                  <NativeSelect value={assistantId} onChange={(e) => setAssistantId(e.target.value)}>
                    {!assistants.some((a) => a.value === assistantId) && assistantId ? (
                      <option value={assistantId}>{assistantId}</option>
                    ) : null}
                    {assistants.map((a) => (
                      <option key={a.value} value={a.value}>
                        {optionLabel(a)}
                      </option>
                    ))}
                  </NativeSelect>
                ) : (
                  <Input
                    value={assistantId}
                    onChange={(e) => setAssistantId(e.target.value)}
                    maxLength={128}
                  />
                )}
              </FormField>
              <FormField
                label={t('vapi.phoneNumberIdLabel')}
                hint={t('vapi.phoneNumberIdHint')}
                error={fieldErrors.phoneNumberId}
              >
                <Input
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  maxLength={128}
                />
              </FormField>
              <DialogFooter className={dialogFooterClass}>
                <Button
                  type="button"
                  variant="outline"
                  className={dialogButtonClass}
                  onClick={() => onOpenChange(false)}
                  disabled={saving}
                >
                  {tCommon('cancel')}
                </Button>
                <Button
                  type="submit"
                  variant="accent"
                  className={dialogButtonClass}
                  disabled={saving}
                  pending={saving}
                >
                  {saving ? tCommon('saving') : tCommon('saveChanges')}
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

function PlaceVapiCallDialog({
  channel,
  onClose,
}: {
  channel: VapiChannelDto;
  onClose: () => void;
}) {
  const t = useTranslations('dashboard.channels');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const [to, setTo] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);

  async function submit() {
    const trimmed = to.trim();
    if (!trimmed) return;
    const payload: Record<string, unknown> = { to: trimmed };
    if (customerName.trim()) payload.customerName = customerName.trim();
    const parsed = VapiCallInitiateBody.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'invalid input');
      return;
    }
    setPlacing(true);
    setError(null);
    try {
      await api(`/v1/conversations/channels/vapi/${channel.id}/call`, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      notify.success(t('vapi.placeCallDialog.success', { to: trimmed }));
      onClose();
    } catch (err) {
      setError(translate(err) || t('errors.placeVapiCall'));
    } finally {
      setPlacing(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('vapi.placeCallDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('vapi.placeCallDialog.description', { name: channel.name })}
          </DialogDescription>
        </DialogHeader>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <FormField
            label={t('vapi.placeCallDialog.toLabel')}
            hint={t('vapi.placeCallDialog.toHint')}
            error={error ?? undefined}
          >
            <Input
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                if (error) setError(null);
              }}
              required
              autoFocus
              placeholder="+15551234567"
              aria-invalid={error ? true : undefined}
            />
          </FormField>
          <FormField
            label={t('vapi.placeCallDialog.customerNameLabel')}
            hint={t('vapi.placeCallDialog.customerNameHint')}
          >
            <Input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              maxLength={120}
            />
          </FormField>
          <DialogFooter className={dialogFooterClass}>
            <Button
              type="button"
              variant="outline"
              className={dialogButtonClass}
              onClick={onClose}
              disabled={placing}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              type="submit"
              variant="accent"
              className={dialogButtonClass}
              disabled={placing || !to.trim()}
              pending={placing}
            >
              {placing
                ? t('vapi.placeCallDialog.placing')
                : t('vapi.placeCallDialog.submit')}
              <span aria-hidden className="ml-1 font-mono">↵</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChannelOptionStage({
  title,
  description,
  fieldLabel,
  fieldHint,
  emptyMessage,
  options,
  value,
  onChange,
  saving,
  onBack,
  onCreate,
}: {
  title: string;
  description: string;
  fieldLabel: string;
  fieldHint: string;
  emptyMessage: string;
  options: ChannelOptionItem[];
  value: string;
  onChange: (value: string) => void;
  saving: boolean;
  onBack: () => void;
  onCreate: () => void;
}) {
  const t = useTranslations('dashboard.channels');
  const tCommon = useTranslations('common');
  const hasOptions = options.length > 0;
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <div className="mt-4 flex flex-col gap-4">
        {hasOptions ? (
          <FormField label={fieldLabel} hint={fieldHint}>
            <NativeSelect value={value} onChange={(e) => onChange(e.target.value)}>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {optionLabel(option)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        ) : (
          <p className={dialogHintClass}>{emptyMessage}</p>
        )}
      </div>
      <DialogFooter className={dialogFooterClass}>
        <Button
          type="button"
          variant="outline"
          className={dialogButtonClass}
          onClick={onBack}
          disabled={saving}
        >
          {tCommon('back')}
        </Button>
        <Button
          type="button"
          variant="accent"
          className={dialogButtonClass}
          onClick={onCreate}
          disabled={saving || !hasOptions}
          pending={saving}
        >
          {saving ? tCommon('creating') : t('addVoiceDialog.create')}
        </Button>
      </DialogFooter>
    </>
  );
}

function ThrellChannelDialog({
  open,
  onOpenChange,
  onSaved,
  editChannel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  editChannel: ThrellChannelDto;
}) {
  const t = useTranslations('dashboard.channels');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const [name, setName] = useState(editChannel.name);
  const [apiKey, setApiKey] = useState('');
  const [workerId, setWorkerId] = useState(editChannel.config?.workerId ?? '');
  const [workers, setWorkers] = useState<ChannelOptionItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<SaveErrorDetail | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setName(editChannel.name);
    setApiKey('');
    setWorkerId(editChannel.config?.workerId ?? '');
    setWorkers([]);
    setSubmitError(null);
    setFieldErrors({});
    setSaving(false);
    let cancelled = false;
    void api<ChannelOptionsResponse>(`/v1/conversations/channels/${editChannel.id}/options`, {
      method: 'POST',
    })
      .then((res) => {
        if (!cancelled) setWorkers(channelOptionsFor(res, 'workers'));
      })
      .catch(() => {
        if (!cancelled) setWorkers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, editChannel]);

  async function submit() {
    const payload: Record<string, unknown> = {
      channelId: editChannel.id,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(apiKey ? { apiKey } : {}),
      ...(workerId.trim() ? { workerId: workerId.trim() } : {}),
    };
    const parsed = ConfigureThrellBody.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(zodIssuesToFieldErrors(parsed.error.issues, t));
      return;
    }
    setFieldErrors({});
    setSaving(true);
    setSubmitError(null);
    try {
      await api('/v1/conversations/channels/threll', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setSubmitError(
        toSaveErrorDetail(err, translate(err) || t('errors.updateThrell'), {
          endpoint: '/v1/conversations/channels/threll',
          method: 'POST',
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {submitError ? (
          <SaveErrorStage
            detail={submitError}
            onBack={() => setSubmitError(null)}
            onRetry={() => void submit()}
            retrying={saving}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('threll.editTitle')}</DialogTitle>
              <DialogDescription>{t('threll.editDescription')}</DialogDescription>
            </DialogHeader>
            <form
              className="mt-4 flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <FormField label={t('nameLabel')} hint={t('threll.nameHint')}>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. main-threll"
                  maxLength={120}
                />
              </FormField>
              <FormField label={t('threll.apiKeyLabel')} hint={t('threll.apiKeyHintEdit')}>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="••••"
                  autoComplete="off"
                />
              </FormField>
              <FormField
                label={t('threll.workerLabel')}
                hint={t('threll.workerHint')}
                error={fieldErrors.workerId}
              >
                {workers.length > 0 ? (
                  <NativeSelect value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
                    {!workers.some((w) => w.value === workerId) && workerId ? (
                      <option value={workerId}>{workerId}</option>
                    ) : null}
                    {workers.map((worker) => (
                      <option key={worker.value} value={worker.value}>
                        {optionLabel(worker)}
                      </option>
                    ))}
                  </NativeSelect>
                ) : (
                  <Input
                    value={workerId}
                    onChange={(e) => setWorkerId(e.target.value)}
                    maxLength={128}
                  />
                )}
              </FormField>
              <DialogFooter className={dialogFooterClass}>
                <Button
                  type="button"
                  variant="outline"
                  className={dialogButtonClass}
                  onClick={() => onOpenChange(false)}
                  disabled={saving}
                >
                  {tCommon('cancel')}
                </Button>
                <Button
                  type="submit"
                  variant="accent"
                  className={dialogButtonClass}
                  disabled={saving}
                  pending={saving}
                >
                  {saving ? tCommon('saving') : tCommon('saveChanges')}
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

function PlaceThrellCallDialog({
  channel,
  onClose,
}: {
  channel: ThrellChannelDto;
  onClose: () => void;
}) {
  const t = useTranslations('dashboard.channels');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const [to, setTo] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);

  async function submit() {
    const trimmed = to.trim();
    if (!trimmed) return;
    const payload: Record<string, unknown> = { to: trimmed };
    if (customerName.trim()) payload.customerName = customerName.trim();
    const parsed = ThrellCallInitiateBody.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'invalid input');
      return;
    }
    setPlacing(true);
    setError(null);
    try {
      await api(`/v1/conversations/channels/threll/${channel.id}/call`, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      notify.success(t('threll.placeCallDialog.success', { to: trimmed }));
      onClose();
    } catch (err) {
      setError(translate(err) || t('errors.placeThrellCall'));
    } finally {
      setPlacing(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('threll.placeCallDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('threll.placeCallDialog.description', { name: channel.name })}
          </DialogDescription>
        </DialogHeader>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <FormField
            label={t('threll.placeCallDialog.toLabel')}
            hint={t('threll.placeCallDialog.toHint')}
            error={error ?? undefined}
          >
            <Input
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                if (error) setError(null);
              }}
              required
              autoFocus
              placeholder="+15551234567"
              aria-invalid={error ? true : undefined}
            />
          </FormField>
          <FormField
            label={t('threll.placeCallDialog.customerNameLabel')}
            hint={t('threll.placeCallDialog.customerNameHint')}
          >
            <Input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              maxLength={120}
            />
          </FormField>
          <DialogFooter className={dialogFooterClass}>
            <Button
              type="button"
              variant="outline"
              className={dialogButtonClass}
              onClick={onClose}
              disabled={placing}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              type="submit"
              variant="accent"
              className={dialogButtonClass}
              disabled={placing || !to.trim()}
              pending={placing}
            >
              {placing
                ? t('threll.placeCallDialog.placing')
                : t('threll.placeCallDialog.submit')}
              <span aria-hidden className="ml-1 font-mono">↵</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
