import { describe, expect, it } from 'vitest';
import { APPROVED_OUTREACH_PROPOSAL_KEY, isWrittenOrApprovedByPerson } from './human-review.ts';

describe('isWrittenOrApprovedByPerson', () => {
  it('counts a message a teammate wrote or sent from a draft', () => {
    expect(isWrittenOrApprovedByPerson({ authorType: 'user', metadata: {} })).toBe(true);
  });

  it('counts an agent message sent for an outreach proposal a person approved', () => {
    expect(
      isWrittenOrApprovedByPerson({
        authorType: 'agent',
        metadata: { [APPROVED_OUTREACH_PROPOSAL_KEY]: 'prop_1' },
      }),
    ).toBe(true);
  });

  it.each([
    ['an auto-reply', {}],
    ['a reply sent from a draft through an API key', { approvedDraft: { draftMessageId: 'msg_1' } }],
    ['a message with no metadata', null],
  ])('does not count %s', (_label, metadata) => {
    expect(isWrittenOrApprovedByPerson({ authorType: 'agent', metadata })).toBe(false);
  });
});
