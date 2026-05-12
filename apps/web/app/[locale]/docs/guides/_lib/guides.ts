export interface GuideMeta {
  slug: string;
  category: 'embeds' | 'concepts' | 'operations';
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
  { id: 'embeds', label: 'Embeds', blurb: 'Drop-in surfaces you put on customer pages.' },
  { id: 'concepts', label: 'Concepts', blurb: 'The mental model. Read these before you wire anything up.' },
  { id: 'operations', label: 'Operations', blurb: 'Running Munin in production — observability, compliance, edges.' },
];

export const GUIDES: GuideMeta[] = [
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
