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
    slug: 'recipe-content-marketer',
    category: 'recipes',
    title: 'Content Marketer',
    kicker:
      'Mines weekly conversations for recurring questions and drafts CMS posts that answer them in customers’ own words.',
    minutes: 4,
    updated: 'today',
    tags: ['recipe', 'cms'],
  },
  {
    slug: 'recipe-crm-deduper',
    category: 'recipes',
    title: 'CRM Deduper',
    kicker:
      'Walks the contact list, scores near-duplicates, and files structured merge proposals — never merges on its own.',
    minutes: 4,
    updated: 'today',
    tags: ['recipe', 'crm'],
  },
  {
    slug: 'recipe-kb-curator',
    category: 'recipes',
    title: 'KB Curator',
    kicker:
      'Watches conversations for KB gaps, drafts new articles, queues them for review — never publishes without a human.',
    minutes: 4,
    updated: 'today',
    tags: ['recipe', 'knowledge-base'],
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
