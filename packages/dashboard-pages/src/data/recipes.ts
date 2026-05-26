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
    id: 'bug-spotter',
    name: 'Bug Spotter',
    summary: 'Spots repeated themes in conversations and flags real product issues for engineering.',
    cadence: 'daily',
    tools: [
      'conv_list_conversations',
      'conv_search_messages',
      'conv_get_conversation',
      'conv_send_message',
    ],
  },
  {
    id: 'content-marketer',
    name: 'Content Marketer',
    summary: 'Mines conversations for FAQs and drafts CMS entries that answer them.',
    cadence: 'weekly',
    tools: [
      'conv_search_messages',
      'kb_search',
      'cms_list_collections',
      'cms_create_entry',
      'cms_publish_entry',
    ],
  },
  {
    id: 'crm-deduper',
    name: 'CRM Deduper',
    summary: 'Finds duplicate contacts, files structured merge proposals for review.',
    cadence: 'daily',
    tools: [
      'crm_list_contacts',
      'crm_search_contacts',
      'crm_propose_merge_candidate',
      'crm_list_merge_proposals',
    ],
  },
  {
    id: 'kb-curator',
    name: 'KB Curator',
    summary: 'Watches conversations for KB gaps, drafts new articles, queues them for review.',
    cadence: 'daily',
    tools: [
      'conv_search_messages',
      'conv_list_conversations',
      'kb_search',
      'kb_propose_curation_candidate',
      'kb_publish_curation_candidate',
    ],
  },
  {
    id: 'outreach-drafter',
    name: 'Outreach Drafter',
    summary: 'Builds outbound campaigns from a brief, drafts personalised opener emails for review.',
    cadence: 'on-demand',
    tools: [
      'crm_list_segments',
      'crm_list_contacts_in_segment',
      'crm_get_contact',
      'outreach_create_campaign',
      'outreach_propose_initial',
    ],
  },
  {
    id: 'renewal-watcher',
    name: 'Renewal Watcher',
    summary: 'Watches deals for upcoming renewals and drafts outreach when contracts approach end.',
    cadence: 'daily',
    tools: [
      'crm_list_deals',
      'crm_get_contact',
      'crm_set_ai_summary',
      'outreach_propose_initial',
    ],
  },
];
