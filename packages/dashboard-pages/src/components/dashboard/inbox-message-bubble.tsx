'use client';

import { useTranslations } from 'next-intl';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@getmunin/ui';
import { MessageComponents } from './inbox-product-list';
import type { MessageDto } from './inbox-types';

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

export function MessageBubble({ message }: { message: MessageDto }) {
  const t = useTranslations('dashboard.overview.drawer');
  const isStaff = message.authorType === 'user';
  const isAgent = message.authorType === 'agent';
  const isOutbound = isStaff || isAgent;
  const isSystem = message.authorType === 'system';

  if (isSystem) {
    return (
      <div className="self-center text-center font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
        — {message.body} —
      </div>
    );
  }
  if (message.internal) {
    return (
      <div
        className={cn(
          'ml-12 flex flex-col gap-1 border-l-2 bg-amber-50 px-3.5 py-2.5 text-sm dark:bg-amber-500/10',
          isStaff ? 'border-cobalt dark:border-cobalt-soft' : 'border-ink dark:border-foreground',
        )}
      >
        <div
          className={cn(
            'font-mono text-[9px] uppercase tracking-eyebrow',
            isStaff ? 'text-cobalt dark:text-cobalt-soft' : 'text-ink-soft dark:text-foreground/80',
          )}
        >
          {t('noteMeta', {
            author: bubbleLabel(message, t),
            time: formatSeenAt(message.createdAt),
          })}
        </div>
        <MessageMarkdown body={message.body} />
      </div>
    );
  }
  return (
    <div className={cn('flex w-full flex-col gap-1', isOutbound ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'max-w-[85%] px-3 py-2 text-sm',
          isStaff
            ? 'rounded-bubble rounded-tr-[2px] bg-cobalt text-paper'
            : isAgent
              ? 'rounded-bubble rounded-tr-[2px] bg-ink text-paper dark:bg-paper dark:text-ink'
              : 'rounded-bubble rounded-tl-[2px] border border-rule-soft bg-paper text-ink dark:border-rule-on-dark dark:bg-card dark:text-foreground',
        )}
      >
        <div
          className={cn(
            'mb-0.5 font-mono text-[9px] uppercase tracking-eyebrow',
            isStaff
              ? 'text-paper/70'
              : isAgent
                ? 'text-paper/70 dark:text-ink/70'
                : 'text-ink-mute',
          )}
        >
          {bubbleLabel(message, t)}
        </div>
        <MessageMarkdown body={message.body} />
      </div>
      {isOutbound && <MessageComponents metadata={message.metadata} />}
      {isOutbound && message.seenAt && (
        <div className="font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute">
          {t('seenAt', { time: formatSeenAt(message.seenAt) })}
        </div>
      )}
    </div>
  );
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
): string {
  if (message.authorName) return message.authorName;
  if (message.authorType === 'end_user') return t('anonymousVisitor');
  return message.authorType;
}
