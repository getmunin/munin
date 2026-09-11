'use client';

import { useTranslations } from 'next-intl';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@getmunin/ui';
import { MessageComponents } from './inbox-product-list';
import { MessageAttachments } from './inbox-attachments';
import { messageRole, participantColor, type MessageRole } from './inbox-identity';
import type { MessageAttachment, MessageDto } from './inbox-types';

const DELIVERY_ERROR_MAX_CHARS = 160;

const MESSAGE_MD_COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  h1: ({ children }) => <p className="mb-2 font-semibold last:mb-0">{children}</p>,
  h2: ({ children }) => <p className="mb-2 font-semibold last:mb-0">{children}</p>,
  h3: ({ children }) => <p className="mb-2 font-semibold last:mb-0">{children}</p>,
  hr: () => <hr className="my-2 border-current/20" />,
  code: ({ children }) => (
    <code className="rounded border border-current/20 px-1 font-mono text-[0.85em]">{children}</code>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
      {children}
    </a>
  ),
};

function MessageMarkdown({ body }: { body: string }) {
  return (
    <div className="break-words [overflow-wrap:anywhere]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MESSAGE_MD_COMPONENTS}>
        {body}
      </ReactMarkdown>
    </div>
  );
}

const ROLE_BUBBLE: Record<Exclude<MessageRole, 'system'>, string> = {
  self: 'border-ink bg-ink text-paper dark:border-paper dark:bg-paper dark:text-ink',
  other:
    'border-verdigris/20 bg-verdigris-tint text-ink dark:border-verdigris-soft/30 dark:bg-verdigris/15 dark:text-foreground',
  agent:
    'border-rule-soft bg-agent-tint text-ink dark:border-rule-on-dark dark:bg-agent-tint-on-dark dark:text-foreground',
};

export function MessageBubble({
  message,
  showAuthor = true,
  viewerUserId = null,
  hue,
  endUserLabel = null,
  onDeleteAttachment,
  onRetryDelivery,
  retryingDelivery = false,
}: {
  message: MessageDto;
  showAuthor?: boolean;
  viewerUserId?: string | null;
  hue?: number;
  endUserLabel?: string | null;
  onDeleteAttachment?: (attachment: MessageAttachment) => void;
  onRetryDelivery?: (message: MessageDto) => void;
  retryingDelivery?: boolean;
}) {
  const t = useTranslations('dashboard.overview.drawer');
  const role = messageRole(message, viewerUserId);
  const isOutbound = message.authorType === 'user' || message.authorType === 'agent';
  const noSpeech = message.metadata.voiceNoSpeech === true;

  if (role === 'system') {
    return (
      <div className="self-center text-center font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink-label">
        — {message.body} —
      </div>
    );
  }
  const label = bubbleLabel(message, t, endUserLabel);
  const suppressed = suppressedKind(message);
  const failure = deliveryFailure(message);
  if (message.internal) {
    return (
      <div
        className={cn(
          'ml-12 flex flex-col gap-1 border-l-2 bg-amber-50 px-3.5 py-2.5 text-sm dark:bg-amber-500/10',
          role === 'self'
            ? 'border-ink dark:border-paper'
            : role === 'other'
              ? 'border-verdigris dark:border-verdigris-soft'
              : 'border-ink-mute',
        )}
        style={hue === undefined ? undefined : { borderLeftColor: participantColor(hue) }}
      >
        <div
          className={cn(
            'font-mono text-[10px] font-medium uppercase tracking-eyebrow',
            role === 'agent' ? 'text-ink-mute' : 'text-ink-soft dark:text-foreground/80',
          )}
        >
          {t('noteMeta', { author: label, time: formatSeenAt(message.createdAt) })}
        </div>
        <MessageMarkdown body={message.body} />
      </div>
    );
  }
  return (
    <div
      className={cn(
        'flex w-full max-w-[86%] flex-col gap-1.5',
        isOutbound ? 'ml-auto items-end' : 'mr-auto items-start',
        showAuthor ? '' : '-mt-2.5',
      )}
    >
      {showAuthor ? (
        <div className="flex items-baseline gap-1.5 font-mono text-[10px] font-medium uppercase tracking-meta text-ink-mute">
          <span
            className={cn(
              'font-semibold',
              role === 'agent' ? 'text-ink-mute' : 'text-ink-soft dark:text-foreground/80',
            )}
            style={hue === undefined ? undefined : { color: participantColor(hue) }}
          >
            {label}
          </span>
          <span>· {formatSeenAt(message.createdAt)}</span>
          {suppressed ? (
            <span className="text-ink-label">
              ·{' '}
              {suppressed === 'bounce'
                ? t('bounceNotice')
                : suppressed === 'no_reply_address'
                  ? t('noReplyAddress')
                  : t('autoReply')}
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        className={cn(
          'max-w-full rounded-bubble border px-[13px] py-2.5 text-[13.5px] leading-[1.45]',
          isOutbound ? 'rounded-br-[4px]' : 'rounded-bl-[4px]',
          hue === undefined ? ROLE_BUBBLE[role] : 'text-ink dark:text-foreground',
        )}
        style={
          hue === undefined
            ? undefined
            : {
                background: `color-mix(in oklab, ${participantColor(hue)} 12%, transparent)`,
                borderColor: `color-mix(in oklab, ${participantColor(hue)} 30%, transparent)`,
              }
        }
      >
        {noSpeech ? (
          <p className="italic opacity-60">{t('noSpeech')}</p>
        ) : (
          <MessageMarkdown body={message.body} />
        )}
      </div>
      <MessageAttachments attachments={message.attachments} onDelete={onDeleteAttachment} />
      {isOutbound && <MessageComponents metadata={message.metadata} />}
      {isOutbound && failure ? (
        <div
          role="status"
          className="flex flex-wrap items-baseline justify-end gap-x-2 gap-y-0.5 text-right font-mono text-[10px] font-medium uppercase tracking-meta text-destructive"
        >
          <span>
            {failure === 'dead'
              ? t('deliveryFailed')
              : t('deliveryRetrying', { attempt: message.deliveryAttempts ?? 0 })}
          </span>
          {message.deliveryError ? (
            <span className="max-w-full normal-case tracking-normal opacity-80 [overflow-wrap:anywhere]">
              {truncateDeliveryError(message.deliveryError)}
            </span>
          ) : null}
          {failure === 'dead' && onRetryDelivery ? (
            <button
              type="button"
              onClick={() => onRetryDelivery(message)}
              disabled={retryingDelivery}
              className="shrink-0 uppercase underline underline-offset-[3px] disabled:opacity-50"
            >
              {retryingDelivery ? t('deliveryRetryPending') : t('deliveryRetry')}
            </button>
          ) : null}
        </div>
      ) : null}
      {isOutbound && !failure && message.seenAt && (
        <div className="font-mono text-[10px] font-medium uppercase tracking-meta text-ink-mute">
          {t('seenAt', { time: formatSeenAt(message.seenAt) })}
        </div>
      )}
    </div>
  );
}

export function deliveryFailure(message: MessageDto): 'dead' | 'failed' | null {
  if (message.authorType !== 'user' && message.authorType !== 'agent') return null;
  if (message.internal) return null;
  const status = message.deliveryStatus;
  return status === 'dead' || status === 'failed' ? status : null;
}

function truncateDeliveryError(error: string): string {
  const collapsed = error.replace(/\s+/g, ' ').trim();
  return collapsed.length > DELIVERY_ERROR_MAX_CHARS
    ? `${collapsed.slice(0, DELIVERY_ERROR_MAX_CHARS)}…`
    : collapsed;
}

function formatSeenAt(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function bubbleLabel(
  message: MessageDto,
  t: ReturnType<typeof useTranslations<'dashboard.overview.drawer'>>,
  endUserLabel: string | null = null,
): string {
  if (message.authorName) return message.authorName;
  if (message.authorType === 'end_user') return endUserLabel ?? t('anonymousVisitor');
  return message.authorType;
}

export function suppressedKind(message: MessageDto): string | null {
  const value = message.metadata['suppressed'];
  return typeof value === 'string' ? value : null;
}

export function startsAuthorGroup(message: MessageDto, previous: MessageDto | undefined): boolean {
  if (!previous) return true;
  if (suppressedKind(previous) !== suppressedKind(message)) return true;
  if (previous.internal !== message.internal) return true;
  if (previous.authorType !== message.authorType) return true;
  if (previous.authorId !== message.authorId) return true;
  return (previous.authorName ?? null) !== (message.authorName ?? null);
}
