import type { useTranslations } from 'next-intl';
import { ApiError } from '../../api';
import type { CrmContactSummary, FeedbackOutboxDto } from './queue-drawers/types';
import type { ConversationDetail, LiveSummary } from './inbox-types';

export const contactLabel = (c: CrmContactSummary) => c.name ?? c.email ?? c.id;

export function feedbackSnippet(
  f: FeedbackOutboxDto,
  tQueue: ReturnType<typeof useTranslations<'dashboard.overview.queue'>>,
): string {
  const scope = f.appScope ? f.appScope.toUpperCase() : tQueue('feedbackScopeFallback');
  const attributed = f.includeOrgName || f.includeUserName;
  return attributed
    ? tQueue('feedbackSnippetAttributed', { scope })
    : tQueue('feedbackSnippet', { scope });
}

export function liveToStubDetail(c: LiveSummary): ConversationDetail {
  const latest = c.latestEndUserMessage;
  return {
    ...c,
    claim: c.claim,
    messages: latest
      ? [
          {
            id: `latest-${c.id}`,
            conversationId: c.id,
            authorType: 'end_user',
            authorId: c.endUserId ?? 'end_user',
            authorName: null,
            body: latest.body,
            internal: false,
            inReplyToId: null,
            attachments: [],
            metadata: {},
            createdAt: latest.createdAt,
          },
        ]
      : [],
  };
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('file read failed'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('file read returned non-string result'));
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

export function mergeLive(
  prev: Record<string, ConversationDetail>,
  live: LiveSummary[],
): Record<string, ConversationDetail> {
  const next = { ...prev };
  for (const c of live) {
    const existing = next[c.id];
    next[c.id] = existing ? { ...existing, ...c, claim: c.claim } : liveToStubDetail(c);
  }
  return next;
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Unknown error';
}

export function clearKey<T>(obj: Record<string, T>, key: string): Record<string, T> {
  if (!(key in obj)) return obj;
  const next = { ...obj };
  delete next[key];
  return next;
}
