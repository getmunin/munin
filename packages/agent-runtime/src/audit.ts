import { openAiCompatibleProvider } from './providers/openai-compatible.js';
import type { ChatMessage, Provider, ProviderConfig } from './types.js';

export type AuditAction =
  | { type: 'request_handover'; reason: string }
  | { type: 'close_conversation'; reason: string }
  | { type: 'snooze_conversation'; untilHours: number; reason: string }
  | { type: 'mark_spam'; reason: string }
  | { type: 'set_topic'; topicSlug: string; reason: string };

export interface AuditTopic {
  slug: string;
  name: string;
  description?: string;
}

export interface AuditConversationArgs {
  provider: ProviderConfig;
  model: string;
  question: string;
  reply: string;
  toolNames: string[];
  topicCatalog?: AuditTopic[];
  providerImpl?: Provider;
  abortSignal?: AbortSignal;
}

export interface AuditVerdict {
  actions: AuditAction[];
}

const ACTION_GUIDE = `Possible actions you can recommend (zero or more):

- {"type": "request_handover", "reason": "<why>"}
  When the agent's reply implies a human teammate should follow up
  (defers, escalates, says "let me flag this", or admits it can't answer).
  Use when the reply text and the tools called don't already include a
  handover.

- {"type": "close_conversation", "reason": "<why>"}
  When the end-user clearly signals the conversation is done — "thanks,
  that's all", "perfect, problem solved", explicit goodbye. Don't use
  for ambiguous replies.

- {"type": "snooze_conversation", "untilHours": <number>, "reason": "<why>"}
  When the user asks to be followed up later, or said "I'll get back to
  you tomorrow" / "next week". Pick a reasonable wait in hours
  (24 = next day, 168 = next week). Don't use for typical questions
  with no waiting cue.

- {"type": "mark_spam", "reason": "<why>"}
  When the user message is clearly automated, promotional, off-topic
  scraping, or junk. Be conservative — only obvious cases. Real
  questions in broken English are NOT spam.

- {"type": "set_topic", "topicSlug": "<slug>", "reason": "<why>"}
  Tag the conversation with one of the org's existing topics, when one
  fits the user's question. Only use slugs from the supplied catalog.
  If no topic fits, skip this action — do not invent slugs.`;

const SYSTEM_PROMPT_HEAD = `You audit a self-service AI agent's turn in a customer-support conversation. Decide which (if any) follow-up actions the runtime should take. Return JSON only:

{"actions": [...]}

Each entry in \`actions\` is one of the action shapes below. Multiple actions can apply (e.g. "set_topic" + "close_conversation"). If no action is needed, return {"actions": []}.

`;

export async function auditConversation(args: AuditConversationArgs): Promise<AuditVerdict> {
  const provider = args.providerImpl ?? openAiCompatibleProvider;
  const systemPrompt = buildSystemPrompt(args.topicCatalog);
  const userPrompt = buildUserPrompt(
    args.question,
    args.reply,
    args.toolNames,
    args.topicCatalog,
  );
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let response;
  const wantsJsonObject = !/anthropic\.com/i.test(args.provider.baseUrl);
  try {
    response = await provider({
      config: {
        provider: args.provider,
        model: args.model,
        systemPrompt,
        responseFormat: wantsJsonObject ? 'json_object' : undefined,
      },
      messages,
      tools: [],
      abortSignal: args.abortSignal,
    });
  } catch {
    return { actions: [] };
  }

  return parseVerdict(response.message.content ?? '', args.topicCatalog);
}

function buildSystemPrompt(topicCatalog: AuditTopic[] | undefined): string {
  const parts = [SYSTEM_PROMPT_HEAD, ACTION_GUIDE];
  if (!topicCatalog || topicCatalog.length === 0) {
    parts.push(
      '\nThe org has no topics defined yet — skip the `set_topic` action entirely.',
    );
  }
  return parts.join('\n');
}

function buildUserPrompt(
  question: string,
  reply: string,
  toolNames: string[],
  topicCatalog: AuditTopic[] | undefined,
): string {
  const lines: string[] = [
    '[End-user question]',
    truncate(question, 4000),
    '',
    '[Agent reply]',
    truncate(reply, 4000),
    '',
    '[Tools the agent already called this turn]',
    toolNames.length > 0 ? toolNames.join(', ') : '(none)',
  ];
  if (topicCatalog && topicCatalog.length > 0) {
    lines.push('', '[Available topic slugs (pick at most one if it fits)]');
    for (const t of topicCatalog) {
      lines.push(`- ${t.slug}: ${t.name}${t.description ? ` — ${t.description}` : ''}`);
    }
  }
  return lines.join('\n');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

function parseVerdict(raw: string, topicCatalog: AuditTopic[] | undefined): AuditVerdict {
  const trimmed = raw.trim();
  if (!trimmed) return { actions: [] };
  const candidates = [trimmed, extractFirstJsonObject(trimmed)].filter(
    (s): s is string => typeof s === 'string',
  );
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { actions?: unknown };
      if (!Array.isArray(parsed.actions)) continue;
      const known = new Set(topicCatalog?.map((t) => t.slug) ?? []);
      const actions: AuditAction[] = [];
      for (const raw of parsed.actions) {
        const action = normaliseAction(raw, known);
        if (action) actions.push(action);
      }
      return { actions };
    } catch {
      continue;
    }
  }
  return { actions: [] };
}

function normaliseAction(raw: unknown, knownTopicSlugs: Set<string>): AuditAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const type = typeof r['type'] === 'string' ? r['type'] : '';
  const reason = typeof r['reason'] === 'string' ? r['reason'] : '';
  switch (type) {
    case 'request_handover':
      return { type: 'request_handover', reason };
    case 'close_conversation':
      return { type: 'close_conversation', reason };
    case 'snooze_conversation': {
      const hours = Number(r['untilHours']);
      if (!Number.isFinite(hours) || hours <= 0) return null;
      return { type: 'snooze_conversation', untilHours: hours, reason };
    }
    case 'mark_spam':
      return { type: 'mark_spam', reason };
    case 'set_topic': {
      const slug = typeof r['topicSlug'] === 'string' ? r['topicSlug'] : '';
      if (!slug || !knownTopicSlugs.has(slug)) return null;
      return { type: 'set_topic', topicSlug: slug, reason };
    }
    default:
      return null;
  }
}

function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}
