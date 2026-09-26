import { dashboardUrl } from '../../common/web-url.ts';

export const MIRRORED_CONVERSATION_EVENT_TYPES: readonly string[] = [
  'conversation.created',
  'conversation.subject_changed',
  'conversation.message.received',
  'conversation.message.sent',
  'conversation.message.body_revised',
  'conversation.status_changed',
  'conversation.assigned',
  'conversation.released',
  'conversation.taken_over',
  'conversation.handover_requested',
  'conversation.handover_resolved',
];

export function conversationUrl(orgId: string, conversationId: string): string {
  return dashboardUrl(orgId, `/conversations/${encodeURIComponent(conversationId)}`);
}
