import { describe, expect, it } from 'vitest';
import { splitDecisionReason } from './decision-reason';

describe('splitDecisionReason', () => {
  it('lifts a machine-readable code out of the message it prefixes', () => {
    expect(
      splitDecisionReason('outreach_invalid: follow-up proposal has no conversationId'),
    ).toEqual({
      code: 'outreach_invalid',
      message: 'follow-up proposal has no conversationId',
    });
  });

  it('keeps a human sentence whole even when it contains a colon', () => {
    expect(splitDecisionReason('Not relevant: the offer expired last week')).toEqual({
      code: null,
      message: 'Not relevant: the offer expired last week',
    });
  });

  it('treats a single lowercase word before a colon as prose, not a code', () => {
    expect(splitDecisionReason('spam: nothing useful here')).toEqual({
      code: null,
      message: 'spam: nothing useful here',
    });
  });

  it('keeps the raw string when a code prefix has no message after it', () => {
    expect(splitDecisionReason('cms_conflict:')).toEqual({
      code: null,
      message: 'cms_conflict:',
    });
  });

  it('returns nothing for a missing or blank reason', () => {
    expect(splitDecisionReason(null)).toBeNull();
    expect(splitDecisionReason('   ')).toBeNull();
  });
});
