import { openAiCompatibleProvider } from './providers/openai-compatible.js';
import type { ChatMessage, Provider, ProviderConfig } from './types.js';

export interface AuditReplyArgs {
  provider: ProviderConfig;
  model: string;
  question: string;
  reply: string;
  toolNames: string[];
  providerImpl?: Provider;
  abortSignal?: AbortSignal;
}

export interface AuditVerdict {
  handover: boolean;
  reason: string;
}

const SYSTEM_PROMPT = `You audit a self-service AI agent's reply to an end-user. The agent has a tool called \`conv_request_handover_in_my_conversation\` that flags the conversation for human staff review.

Decide whether the agent's reply IMPLIES it can't fully handle the question and a human teammate should follow up.

Counts as handover-needed:
- The reply tells the user that someone else (a teammate, colleague, human, staff) will follow up, look into it, get back to them.
- The reply defers, escalates, punts, or admits "I don't have that information" without giving a useful answer.
- The reply asks the user to wait while a person takes over.

Does NOT count as handover-needed:
- A complete answer (even brief) drawn from the knowledge base or tools.
- A clarifying question to narrow down what the user is asking.
- A polite refusal grounded in a stated policy ("we can't process refunds older than 60 days").
- An acknowledgement of an action the agent itself performed via tools.

Return JSON only, no prose:
{"handover": true|false, "reason": "<one-sentence justification>"}`;

export async function auditReply(args: AuditReplyArgs): Promise<AuditVerdict> {
  const provider = args.providerImpl ?? openAiCompatibleProvider;
  const userPrompt = buildUserPrompt(args.question, args.reply, args.toolNames);
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  let response;
  try {
    response = await provider({
      config: {
        provider: args.provider,
        model: args.model,
        systemPrompt: SYSTEM_PROMPT,
        responseFormat: 'json_object',
      },
      messages,
      tools: [],
      abortSignal: args.abortSignal,
    });
  } catch {
    return { handover: false, reason: '' };
  }

  const raw = response.message.content ?? '';
  return parseVerdict(raw);
}

function buildUserPrompt(question: string, reply: string, toolNames: string[]): string {
  const tools = toolNames.length > 0 ? toolNames.join(', ') : '(none)';
  return [
    `[End-user question]`,
    truncate(question, 4000),
    ``,
    `[Agent reply]`,
    truncate(reply, 4000),
    ``,
    `[Tools the agent already called this turn]`,
    tools,
  ].join('\n');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

function parseVerdict(raw: string): AuditVerdict {
  const trimmed = raw.trim();
  if (!trimmed) return { handover: false, reason: '' };
  const candidates = [trimmed, extractFirstJsonObject(trimmed)].filter(
    (s): s is string => typeof s === 'string',
  );
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Partial<AuditVerdict>;
      if (typeof parsed.handover === 'boolean') {
        return {
          handover: parsed.handover,
          reason: typeof parsed.reason === 'string' ? parsed.reason : '',
        };
      }
    } catch {
      continue;
    }
  }
  return { handover: false, reason: '' };
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
