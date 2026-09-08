import type { useTranslations } from 'next-intl';
import { formatPhoneNumber } from '../../lib/format-phone';
import type { CrmContactSummary, FeedbackOutboxDto } from './queue-panes/types';

export const contactLabel = (c: CrmContactSummary) => c.name ?? c.email ?? c.id;

export interface CustomerIdentity {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export function customerIdentity(customer: CustomerIdentity): string | null {
  return (
    customer.name ?? customer.email ?? (customer.phone ? formatPhoneNumber(customer.phone) : null)
  );
}

export function customerLabel(customer: CustomerIdentity, fallback: string): string {
  return customerIdentity(customer) ?? fallback;
}

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
