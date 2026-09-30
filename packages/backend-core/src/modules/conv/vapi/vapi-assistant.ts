import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';
import {
  COMPANY_PROFILE_SLUG,
  VOICE_SYSTEM_PROMPT_SLUG,
  type KbDocLocation,
  type KbDocReader,
  type PromptCache,
} from '@getmunin/core';
import type { VapiFunctionTool } from './vapi-tool-bridge.ts';

export interface ChatMessageSeed {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export const INHERITED_ASSISTANT_FIELDS = [
  'voice',
  'transcriber',
  'voicemailDetection',
  'voicemailMessage',
  'endCallMessage',
  'endCallPhrases',
  'maxDurationSeconds',
  'silenceTimeoutSeconds',
  'backgroundSound',
  'backgroundDenoisingEnabled',
  'modelOutputInMessagesEnabled',
  'recordingEnabled',
  'server',
] as const;

export function composeVoiceSystemPrompt(
  prompts: PromptCache,
  conversationId: string,
  extraContext?: string,
): string {
  const base = prompts.get(VOICE_SYSTEM_PROMPT_SLUG);
  const idLine = `When a tool asks for a conversationId, pass exactly: ${conversationId} — never substitute placeholders.`;
  const companyContext = prompts.get(COMPANY_PROFILE_SLUG);
  const head = `${base} ${idLine}`;
  const parts = [head];
  if (companyContext) parts.push(`[Company context]\n${companyContext}`);
  if (extraContext) parts.push(extraContext);
  return parts.join('\n\n');
}

export class OrgScopedKbDocReader implements KbDocReader {
  constructor(
    private readonly db: Db,
    private readonly orgId: string,
  ) {}

  async getBody(location: KbDocLocation): Promise<string | null> {
    const rows = await this.db
      .select({ body: schema.kbDocuments.body })
      .from(schema.kbDocuments)
      .innerJoin(schema.kbSpaces, eq(schema.kbDocuments.spaceId, schema.kbSpaces.id))
      .where(
        and(
          eq(schema.kbDocuments.orgId, this.orgId),
          eq(schema.kbSpaces.slug, location.spaceSlug),
          eq(schema.kbDocuments.slug, location.slug),
        ),
      )
      .limit(1);
    const body = rows[0]?.body?.trim() ?? null;
    return body && body.length > 0 ? body : null;
  }
}

export function buildInlineAssistantConfig(opts: {
  baseConfig: Record<string, unknown>;
  messages: ChatMessageSeed[];
  tools: VapiFunctionTool[];
}): Record<string, unknown> {
  const inline: Record<string, unknown> = {};
  for (const key of INHERITED_ASSISTANT_FIELDS) {
    if (opts.baseConfig[key] !== undefined) inline[key] = opts.baseConfig[key];
  }
  inline.model = buildModel(opts.baseConfig, opts.messages, opts.tools, { browserSafe: false });
  inline.firstMessageMode = FIRST_MESSAGE_MODE;
  inline.serverMessages = [...SERVER_MESSAGES];
  return inline;
}

export function buildBrowserAssistantOverrides(opts: {
  baseConfig: Record<string, unknown>;
  messages: ChatMessageSeed[];
  tools: VapiFunctionTool[];
}): Record<string, unknown> {
  return {
    model: buildModel(opts.baseConfig, opts.messages, opts.tools, { browserSafe: true }),
    firstMessageMode: FIRST_MESSAGE_MODE,
    serverMessages: [...SERVER_MESSAGES],
  };
}

const FIRST_MESSAGE_MODE = 'assistant-speaks-first-with-model-generated-message';

const SERVER_MESSAGES = [
  'conversation-update',
  'tool-calls',
  'end-of-call-report',
  'status-update',
] as const;

function buildModel(
  baseConfig: Record<string, unknown>,
  messages: ChatMessageSeed[],
  tools: VapiFunctionTool[],
  opts: { browserSafe: boolean },
): Record<string, unknown> {
  const baseModel =
    baseConfig.model && typeof baseConfig.model === 'object'
      ? (baseConfig.model as Record<string, unknown>)
      : {};
  const rawBaseTools = Array.isArray(baseModel.tools) ? (baseModel.tools as unknown[]) : [];
  const baseTools = opts.browserSafe ? rawBaseTools.filter(isBrowserSafeTool) : rawBaseTools;
  const model: Record<string, unknown> = {
    provider: typeof baseModel.provider === 'string' ? baseModel.provider : 'openai',
    model: typeof baseModel.model === 'string' ? baseModel.model : 'gpt-4o-mini',
    messages,
    tools: [...baseTools, ...tools],
  };
  if (opts.browserSafe && Array.isArray(baseModel.toolIds)) {
    model.toolIds = baseModel.toolIds.filter((id): id is string => typeof id === 'string');
  }
  if (typeof baseModel.temperature === 'number') model.temperature = baseModel.temperature;
  if (typeof baseModel.maxTokens === 'number') model.maxTokens = baseModel.maxTokens;
  if (typeof baseModel.emotionRecognitionEnabled === 'boolean') {
    model.emotionRecognitionEnabled = baseModel.emotionRecognitionEnabled;
  }
  if (typeof baseModel.numFastTurns === 'number') model.numFastTurns = baseModel.numFastTurns;
  return model;
}

function isBrowserSafeTool(tool: unknown): boolean {
  if (!tool || typeof tool !== 'object') return false;
  const record = tool as Record<string, unknown>;
  return record.server === undefined && record.credentialId === undefined;
}
