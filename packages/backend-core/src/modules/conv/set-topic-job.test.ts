import { describe, expect, it } from 'vitest';
import { KNOWN_SKILL_URIS, tierFor, toolPrefixesFor } from '@getmunin/types';
import { SET_TOPIC_AND_TITLE_SKILL_URI, buildSetTopicAndTitleJob } from './set-topic-job.ts';

describe('buildSetTopicAndTitleJob', () => {
  it('targets the registered set-topic-and-title skill', () => {
    expect(SET_TOPIC_AND_TITLE_SKILL_URI).toBe('skill://conv/set-topic-and-title');
    expect(KNOWN_SKILL_URIS.has(SET_TOPIC_AND_TITLE_SKILL_URI)).toBe(true);
    expect(tierFor(SET_TOPIC_AND_TITLE_SKILL_URI)).toBe('fast');
    expect(toolPrefixesFor(SET_TOPIC_AND_TITLE_SKILL_URI)).toEqual([
      'conv_get_conversation',
      'conv_list_topics',
      'conv_create_topic',
      'conv_set_topic',
      'conv_set_subject',
    ]);
  });

  it('names the conversation and carries an idempotent dedupe key', () => {
    const job = buildSetTopicAndTitleJob({ conversationId: 'ccv_123', channelType: 'chat' });
    expect(job.jobUri).toBe(SET_TOPIC_AND_TITLE_SKILL_URI);
    expect(job.userPrompt).toContain('ccv_123');
    expect(job.dedupeKey).toBe('conv-set-topic:conv:ccv_123');
    expect(job.sourceEventPayload).toEqual({ conversationId: 'ccv_123', channelType: 'chat' });
  });

  it('defaults the source event and tolerates an unknown channel type', () => {
    const job = buildSetTopicAndTitleJob({ conversationId: 'ccv_9' });
    expect(job.sourceEventType).toBe('conversation.created');
    expect(job.sourceEventPayload).toEqual({ conversationId: 'ccv_9', channelType: null });
  });
});
