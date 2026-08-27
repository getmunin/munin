import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_MIN_SAMPLE,
  automationHold,
  ratePercent,
  resolveEffectiveAgentMode,
} from './agent-mode.ts';

describe('resolveEffectiveAgentMode', () => {
  it('lets a topic policy govern a conversation still on its channel default', () => {
    expect(
      resolveEffectiveAgentMode({
        conversationMode: 'draft_only',
        source: 'default',
        topicMode: 'auto',
      }),
    ).toBe('auto');
  });

  it('never overrides a mode an operator set deliberately', () => {
    expect(
      resolveEffectiveAgentMode({
        conversationMode: 'off',
        source: 'explicit',
        topicMode: 'auto',
      }),
    ).toBe('off');
  });

  it('falls back to the conversation when the topic has no policy', () => {
    expect(
      resolveEffectiveAgentMode({
        conversationMode: 'draft_only',
        source: 'default',
        topicMode: null,
      }),
    ).toBe('draft_only');
  });

  it('ignores a topic mode that is not a known agent mode', () => {
    expect(
      resolveEffectiveAgentMode({
        conversationMode: 'draft_only',
        source: 'default',
        topicMode: 'sometimes',
      }),
    ).toBe('draft_only');
  });
});

describe('automationHold', () => {
  function counts(unedited: number, edited: number, rejected: number) {
    return { unedited, edited, rejected };
  }

  it('holds on sample size below the minimum, however perfect the record', () => {
    expect(automationHold(counts(AUTOMATION_MIN_SAMPLE - 1, 0, 0))).toBe('sample');
  });

  it('clears once the sample is large enough and the record is clean', () => {
    expect(automationHold(counts(AUTOMATION_MIN_SAMPLE, 0, 0))).toBeNull();
  });

  it('holds on rejections before it holds on edits, because a rejection is the worse signal', () => {
    expect(automationHold(counts(50, 40, 10))).toBe('rejected');
  });

  it('holds when too many drafts needed editing', () => {
    expect(automationHold(counts(80, 20, 0))).toBe('unedited');
  });

  it('accepts a record exactly on the unedited threshold', () => {
    expect(automationHold(counts(85, 15, 0))).toBeNull();
  });

  it('holds an empty record as sample rather than dividing by zero', () => {
    expect(automationHold(counts(0, 0, 0))).toBe('sample');
  });
});

describe('ratePercent', () => {
  it('is zero rather than NaN when nothing was reviewed', () => {
    expect(ratePercent(0, 0)).toBe(0);
  });

  it('rounds to whole percent', () => {
    expect(ratePercent(1, 3)).toBe(33);
    expect(ratePercent(2, 3)).toBe(67);
  });
});
