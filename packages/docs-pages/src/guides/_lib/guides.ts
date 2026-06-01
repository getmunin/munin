export interface GuideMeta {
  slug: string;
  category: 'clients' | 'embeds' | 'concepts' | 'operations' | 'recipes';
  title: string;
  kicker: string;
  minutes: number;
  updated: string;
  featured?: boolean;
  tags?: string[];
}

export const GUIDE_GROUPS: Array<{
  id: GuideMeta['category'];
  label: string;
  blurb: string;
}> = [
  { id: 'clients', label: 'Clients', blurb: 'Wire your favourite model to Munin over MCP.' },
  { id: 'embeds', label: 'Embeds', blurb: 'Drop-in surfaces you put on customer pages.' },
  { id: 'concepts', label: 'Concepts', blurb: 'The mental model. Read these before you wire anything up.' },
  { id: 'operations', label: 'Operations', blurb: 'Running Munin in production — observability, compliance, edges.' },
  { id: 'recipes', label: 'Recipes', blurb: 'Ready-to-paste agent prompts that take Munin from inbox to outcome.' },
];

export const GUIDES: GuideMeta[] = [
  {
    slug: 'connect-claude',
    category: 'clients',
    title: 'Connect Claude',
    kicker: 'Wire Claude Desktop and Claude.ai to your Munin org over MCP.',
    minutes: 3,
    updated: 'today',
    tags: ['mcp', 'claude'],
  },
  {
    slug: 'connect-chatgpt',
    category: 'clients',
    title: 'Connect ChatGPT',
    kicker: 'Add Munin as a custom connector in ChatGPT.',
    minutes: 3,
    updated: 'today',
    tags: ['mcp', 'chatgpt'],
  },
  {
    slug: 'connect-gemini',
    category: 'clients',
    title: 'Connect Gemini',
    kicker: 'Wire the Gemini CLI to your Munin org over MCP.',
    minutes: 3,
    updated: 'today',
    tags: ['mcp', 'gemini'],
  },
  {
    slug: 'chat-widget',
    category: 'embeds',
    title: 'The embeddable chat widget',
    kicker:
      'A single script tag, an opinionated UI, and a path to a human when the agent is out of its depth.',
    minutes: 8,
    updated: 'today',
    featured: true,
    tags: ['embed', 'javascript', 'frontend'],
  },
  {
    slug: 'audiences-and-tokens',
    category: 'concepts',
    title: 'Audiences, tokens, and what your agent can see',
    kicker:
      'Why an admin key and an end-user token meet two different versions of the same API — and how to choose between them.',
    minutes: 7,
    updated: '5 days ago',
    tags: ['auth', 'security'],
  },
  {
    slug: 'skills-vs-tools-vs-rest',
    category: 'concepts',
    title: 'Skills vs. tools vs. REST',
    kicker:
      "Three surfaces that look interchangeable on a slide, and aren't. A short guide to picking the right one.",
    minutes: 6,
    updated: '2 weeks ago',
    tags: ['architecture'],
  },
  {
    slug: 'recipe-lead-enricher',
    category: 'recipes',
    title: 'Lead Enricher',
    kicker:
      'When a contact lands, scrapes their company site and fills role, seniority, and industry on the CRM record.',
    minutes: 4,
    updated: 'today',
    tags: ['recipe', 'crm'],
  },
  {
    slug: 'recipe-lead-scorer',
    category: 'recipes',
    title: 'Lead Scorer',
    kicker:
      'Ranks a segment by fit and intent using enrichment data, conversation tone, and recent activity.',
    minutes: 5,
    updated: 'today',
    tags: ['recipe', 'crm'],
  },
  {
    slug: 'recipe-bug-spotter',
    category: 'recipes',
    title: 'Bug Spotter',
    kicker:
      'Clusters broken-behaviour phrases across conversations and posts internal notes engineering can triage.',
    minutes: 4,
    updated: 'today',
    tags: ['recipe', 'conversations'],
  },
  {
    slug: 'recipe-conversation-distiller',
    category: 'recipes',
    title: 'Conversation Distiller',
    kicker:
      'Reads recent conversations for recurring themes — questions, complaints, feature asks — and drafts a CMS entry for each.',
    minutes: 4,
    updated: 'today',
    tags: ['recipe', 'cms', 'conversations'],
  },
  {
    slug: 'recipe-renewal-watcher',
    category: 'recipes',
    title: 'Renewal Watcher',
    kicker:
      'Surfaces deals approaching renewal, scores account health, and drafts account-management outreach for review.',
    minutes: 5,
    updated: 'today',
    tags: ['recipe', 'crm', 'outreach'],
  },
  {
    slug: 'recipe-win-back',
    category: 'recipes',
    title: 'Win-Back Agent',
    kicker:
      'Finds contacts dormant for 90+ days and drafts a re-engagement note tied to something new in the KB.',
    minutes: 5,
    updated: 'today',
    tags: ['recipe', 'outreach', 'crm'],
  },
  {
    slug: 'recipe-event-followup',
    category: 'recipes',
    title: 'Event Follow-up',
    kicker:
      'Bulk-loads an attendee list into the CRM, then drafts personalised post-event openers tied to what was discussed.',
    minutes: 4,
    updated: 'today',
    tags: ['recipe', 'outreach', 'crm'],
  },
  {
    slug: 'recipe-outreach-drafter',
    category: 'recipes',
    title: 'Outreach Drafter',
    kicker:
      'Takes a campaign brief, targets a CRM segment, and queues personalised opener emails for human approval.',
    minutes: 5,
    updated: 'today',
    tags: ['recipe', 'outreach'],
  },
];

export function guidesByCategory(): Map<GuideMeta['category'], GuideMeta[]> {
  const map = new Map<GuideMeta['category'], GuideMeta[]>();
  for (const g of GUIDE_GROUPS) map.set(g.id, []);
  for (const g of GUIDES) map.get(g.category)?.push(g);
  return map;
}

export function findGuide(slug: string): GuideMeta | undefined {
  return GUIDES.find((g) => g.slug === slug);
}
