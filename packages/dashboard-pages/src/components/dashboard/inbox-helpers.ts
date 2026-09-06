import type { useTranslations } from 'next-intl';
import type { CrmContactSummary, FeedbackOutboxDto } from './queue-drawers/types';

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

export function clearKey<T>(obj: Record<string, T>, key: string): Record<string, T> {
  if (!(key in obj)) return obj;
  const next = { ...obj };
  delete next[key];
  return next;
}
