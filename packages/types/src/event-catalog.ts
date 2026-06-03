export const CMS_EVENT_TYPES = [
  'cms.collection.created',
  'cms.collection.fields_changed',
  'cms.entry.created',
  'cms.entry.updated',
  'cms.entry.published',
  'cms.entry.unpublished',
  'cms.entry.scheduled',
  'cms.entry.deleted',
] as const;

export const CRM_EVENT_TYPES = [
  'crm.contact.created',
  'crm.contact.updated',
  'crm.company.created',
  'crm.deal.created',
  'crm.deal.stage_changed',
  'crm.activity.logged',
  'crm.merge_proposal.proposed',
] as const;

export const KB_EVENT_TYPES = [
  'kb.document.created',
  'kb.document.updated',
  'kb.document.deleted',
] as const;

export const CONVERSATION_EVENT_TYPES = [
  'conversation.created',
  'conversation.status_changed',
  'conversation.assigned',
  'conversation.released',
  'conversation.taken_over',
  'conversation.agent_mode_changed',
  'conversation.handover_requested',
  'conversation.handover_resolved',
  'conversation.greet_requested',
  'conversation.message.received',
  'conversation.message.sent',
  'conversation.voice.call_ended',
] as const;

export const OUTREACH_EVENT_TYPES = [
  'outreach.proposal.created',
  'outreach.proposal.updated',
  'outreach.proposal.sent',
  'outreach.proposal.dismissed',
] as const;

export const SYSTEM_EVENT_TYPES = [
  'org_alert.opened',
  'org_alert.acknowledged',
  'org_alert.resolved',
  'curator_job.pending',
] as const;

export const EVENT_TYPES_BY_MODULE = {
  cms: CMS_EVENT_TYPES,
  crm: CRM_EVENT_TYPES,
  kb: KB_EVENT_TYPES,
  conv: CONVERSATION_EVENT_TYPES,
  outreach: OUTREACH_EVENT_TYPES,
  system: SYSTEM_EVENT_TYPES,
} as const;

export const KNOWN_EVENT_TYPES = [
  ...CMS_EVENT_TYPES,
  ...CRM_EVENT_TYPES,
  ...KB_EVENT_TYPES,
  ...CONVERSATION_EVENT_TYPES,
  ...OUTREACH_EVENT_TYPES,
  ...SYSTEM_EVENT_TYPES,
] as const;

export type KnownEventType = (typeof KNOWN_EVENT_TYPES)[number];
export type EventModule = keyof typeof EVENT_TYPES_BY_MODULE;

const KNOWN_SET: ReadonlySet<string> = new Set(KNOWN_EVENT_TYPES);

export function isKnownEventType(value: string): value is KnownEventType {
  return KNOWN_SET.has(value);
}
