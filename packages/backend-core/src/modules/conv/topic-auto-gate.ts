import { sql } from 'drizzle-orm';
import { schema } from '@getmunin/db';

export const AUTO_GATE_WINDOW_DAYS = 30;

const APPROVED_UNEDITED = sql`COUNT(*) FILTER (
  WHERE m.internal = false
    AND m.author_type = 'user'
    AND m.metadata -> 'approvedDraft' ->> 'edited' = 'false'
)`;

const EDITED = sql`COUNT(*) FILTER (
  WHERE m.internal = false
    AND m.author_type = 'user'
    AND m.metadata -> 'approvedDraft' ->> 'edited' = 'true'
)`;

const REJECTED = sql`COUNT(*) FILTER (
  WHERE m.internal = true AND m.metadata ->> 'kind' = 'draft_reply_rejected'
)`;

export const topicUneditedPctSql = sql<number | null>`(
  SELECT round(
    100.0 * ${APPROVED_UNEDITED}
    / NULLIF(${APPROVED_UNEDITED} + ${EDITED} + ${REJECTED}, 0)
  )
  FROM conv_messages m
  JOIN conv_conversations tc ON tc.id = m.conversation_id
  WHERE tc.topic_id = ${schema.convTopics.id}
    AND m.created_at > now() - make_interval(days => ${AUTO_GATE_WINDOW_DAYS})
)`;

export const effectiveAgentModeSql = sql<string>`CASE
  WHEN ${schema.convTopics.agentMode} IS NULL THEN ${schema.convConversations.agentMode}
  WHEN ${schema.convTopics.agentMode} <> 'auto' THEN ${schema.convTopics.agentMode}
  WHEN COALESCE(${topicUneditedPctSql}, -1) >= ${schema.convTopics.promoteThresholdPct} THEN 'auto'
  ELSE 'draft_only'
END`;
