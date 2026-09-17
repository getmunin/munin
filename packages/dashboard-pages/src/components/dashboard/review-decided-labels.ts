import { contactLabel } from './inbox-helpers';
import type { ReviewDecidedItem } from './review-decided';

type Translate = (key: string, values?: Record<string, string | number>) => string;

export function decidedTitle(item: ReviewDecidedItem, t: Translate): string {
  switch (item.kind) {
    case 'kb':
      return item.raw.title;
    case 'crm':
      return `${contactLabel(item.raw.contactA)} ↔ ${contactLabel(item.raw.contactB)}`;
    case 'outreach':
      return item.raw.draftSubject ?? item.raw.campaign?.name ?? t('decidedUntitled');
    case 'cms':
      return item.raw.title ?? t('decidedUntitled');
    case 'feedback':
      return item.raw.title;
    case 'social':
      return t('decidedSocialVariant', { label: item.raw.variantLabel });
  }
}

export function decidedOutcomeLabel(item: ReviewDecidedItem, t: Translate): string {
  if (item.outcome === 'failed') return t('outcomeFailed');
  const key = item.outcome === 'approved' ? 'outcomeApproved' : 'outcomeDismissed';
  return t(`${key}.${item.kind}`);
}

export function decidedConversationId(item: ReviewDecidedItem): string | null {
  if (item.kind === 'kb') return item.raw.sourceConversationId;
  if (item.kind === 'outreach') return item.raw.conversationId;
  return null;
}
