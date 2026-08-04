import type { ApprovalSubjectType } from './slack-projection.ts';

export const SLACK_MIRRORED_EVENT_TYPES: readonly string[] = [
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
];

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

export function readWebBaseUrl(): string {
  return (process.env.MUNIN_WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
}
