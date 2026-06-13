export type RecipeCadence = 'continuous' | 'daily' | 'weekly' | 'event-driven' | 'on-demand';

export interface Recipe {
  id: string;
  name: string;
  summary: string;
  cadence: RecipeCadence;
  tools: string[];
}

export const RECIPES: Recipe[] = [
  {
    id: 'lead-research',
    name: 'Lead Research',
    summary:
      'When a contact lands, scrapes their company site and fills role, seniority, and industry on the CRM record.',
    cadence: 'event-driven',
    tools: ['crm_get_contact', 'crm_update_contact', 'crm_set_ai_summary'],
  },
  {
    id: 'lead-scoring',
    name: 'Lead Scoring',
    summary:
      'Ranks a segment by fit and intent using enrichment data, conversation tone, and recent activity.',
    cadence: 'weekly',
    tools: [
      'crm_list_contacts_in_segment',
      'crm_get_contact',
      'crm_list_activities',
      'conv_search_messages',
      'crm_set_ai_summary',
    ],
  },
  {
    id: 'bug-triage',
    name: 'Bug Triage',
    summary:
      'Clusters broken-behaviour phrases across conversations and files internal notes engineering can triage.',
    cadence: 'daily',
    tools: [
      'conv_list_conversations',
      'conv_search_messages',
      'conv_get_conversation',
      'conv_send_message',
    ],
  },
  {
    id: 'conversation-distiller',
    name: 'Conversation Distiller',
    summary:
      'Reads recent conversations for recurring themes — questions, complaints, feature asks — and drafts a CMS entry for each.',
    cadence: 'weekly',
    tools: ['conv_list_conversations', 'conv_search_messages', 'kb_search', 'cms_create_entry'],
  },
  {
    id: 'renewal-watch',
    name: 'Renewal Watch',
    summary:
      'Surfaces deals approaching renewal, scores account health, and drafts account-management outreach for review.',
    cadence: 'daily',
    tools: [
      'crm_list_deals',
      'crm_get_contact',
      'crm_set_ai_summary',
      'outreach_propose_initial',
    ],
  },
  {
    id: 'sdr',
    name: 'SDR',
    summary:
      'Takes a campaign brief, targets a CRM segment, and queues personalised opener emails for human approval.',
    cadence: 'on-demand',
    tools: [
      'crm_list_segments',
      'crm_list_contacts_in_segment',
      'crm_get_contact',
      'outreach_create_campaign',
      'outreach_propose_initial',
    ],
  },
];
