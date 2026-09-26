import type { ApprovalSubjectType } from './slack-projection.ts';
import { dashboardUrl, readWebBaseUrl } from '../../common/web-url.ts';

export const SLACK_MIRRORED_EVENT_TYPES: readonly string[] = [
  'conversation.created',
  'conversation.subject_changed',
  'conversation.message.received',
  'conversation.message.sent',
  'conversation.message.body_revised',
  'conversation.message.transcribed',
  'conversation.status_changed',
  'conversation.assigned',
  'conversation.released',
  'conversation.taken_over',
  'conversation.handover_requested',
  'conversation.handover_resolved',
];

export const SLACK_APPROVAL_EVENT_TYPES: readonly string[] = [
  'crm.merge_proposal.proposed',
  'crm.merge_proposal.applied',
  'crm.merge_proposal.dismissed',
  'outreach.proposal.created',
  'outreach.proposal.updated',
  'outreach.proposal.sent',
  'outreach.proposal.dismissed',
  'outreach.proposal.withdrawn',
  'kb.curation_candidate.proposed',
  'kb.curation_candidate.published',
  'kb.curation_candidate.dismissed',
  'social.post_draft.proposed',
  'social.post_draft.revised',
  'social.post_draft.published',
  'social.post_draft.dismissed',
  'social.post_draft.failed',
  'cms.entry.created',
  'cms.entry.updated',
  'cms.entry.published',
  'cms.entry.scheduled',
  'cms.entry.archived',
  'cms.entry.deleted',
];

export const SLACK_ANNOUNCEMENT_EVENT_TYPES: readonly string[] = ['cms.entry.published'];

export const SLACK_ANNOUNCEMENT_SUBJECT_TYPES: readonly string[] = ['cms_entry'];

export function subjectTypeOf(subjectKey: string | null): string | null {
  if (!subjectKey) return null;
  const sep = subjectKey.indexOf(':');
  return sep > 0 ? subjectKey.slice(0, sep) : null;
}

export function announcementSubjectRef(
  eventType: string,
  payload: Record<string, unknown>,
): { subjectType: string; subjectId: string } | null {
  if (eventType !== 'cms.entry.published') return null;
  if (payload.previousStatus === 'published') return null;
  const id =
    typeof payload.entryId === 'string' && payload.entryId.length > 0 ? payload.entryId : null;
  return id ? { subjectType: 'cms_entry', subjectId: id } : null;
}

export function approvalSubjectRef(
  eventType: string,
  payload: Record<string, unknown>,
): { subjectType: ApprovalSubjectType; subjectId: string } | null {
  const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
  if (eventType.startsWith('crm.merge_proposal.')) {
    const id = str(payload.id);
    return id ? { subjectType: 'crm_merge_proposal', subjectId: id } : null;
  }
  if (eventType.startsWith('outreach.proposal.')) {
    const id = str(payload.proposalId);
    return id ? { subjectType: 'outreach_proposal', subjectId: id } : null;
  }
  if (eventType.startsWith('kb.curation_candidate.')) {
    const id = str(payload.candidateDocumentId);
    return id ? { subjectType: 'kb_curation_candidate', subjectId: id } : null;
  }
  if (eventType.startsWith('social.post_draft.')) {
    const id = str(payload.draftId);
    return id ? { subjectType: 'social_post_draft', subjectId: id } : null;
  }
  if (eventType.startsWith('cms.entry.')) {
    if (eventType === 'cms.entry.created' && payload.status !== 'draft') return null;
    if (eventType === 'cms.entry.published' && payload.previousStatus === 'published') return null;
    const id = str(payload.entryId);
    return id ? { subjectType: 'cms_draft_entry', subjectId: id } : null;
  }
  return null;
}

export const SLACK_BOT_SCOPES = [
  'chat:write',
  'chat:write.customize',
  'channels:read',
  'channels:history',
  'users:read',
  'users:read.email',
] as const;

export interface SlackAppConfig {
  clientId: string;
  clientSecret: string;
}

export function readSlackAppConfig(): SlackAppConfig | null {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function readSlackSigningSecret(): string | null {
  return process.env.SLACK_SIGNING_SECRET || null;
}

export { dashboardUrl, readWebBaseUrl };

export function conversationUrl(orgId: string, conversationId: string): string {
  return dashboardUrl(orgId, `/conversations/${encodeURIComponent(conversationId)}`);
}

export function reviewUrl(orgId: string, subjectId: string): string {
  return dashboardUrl(orgId, `/review/${encodeURIComponent(subjectId)}`);
}

export function reviewListUrl(orgId: string): string {
  return dashboardUrl(orgId, '/review');
}
