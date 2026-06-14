import type { EnqueueInput } from '../curator/curator-jobs.service.ts';

export const SET_TOPIC_AND_TITLE_SKILL_URI = 'skill://conv/set-topic-and-title';

/**
 * Build the curator job that classifies a freshly-created inbound
 * conversation into a topic and gives it a short title. Enqueue this once,
 * at the point the conversation is created from its first end-user message —
 * the `dedupeKey` keeps repeated calls (retries, batched inbound) idempotent.
 */
export function buildSetTopicAndTitleJob(input: {
  conversationId: string;
  channelType?: string;
  sourceEventType?: string;
}): EnqueueInput {
  const { conversationId } = input;
  return {
    jobUri: SET_TOPIC_AND_TITLE_SKILL_URI,
    userPrompt:
      `Give conversation ${conversationId} a topic and a title. ` +
      `Follow skill://conv/set-topic-and-title exactly. Per-conversation mode: skip any listing ` +
      `of other conversations and go straight to conv_get_conversation(${conversationId}). Pick the ` +
      `best-fitting existing topic (or create one only when you're confident none fit), set it via ` +
      `conv_set_topic, and — only if the conversation has no subject yet — set a short title via ` +
      `conv_set_subject. At most one conv_set_topic and one conv_set_subject call, then stop.`,
    sourceEventType: input.sourceEventType ?? 'conversation.created',
    sourceEventPayload: { conversationId, channelType: input.channelType ?? null },
    dedupeKey: `conv-set-topic:conv:${conversationId}`,
  };
}
