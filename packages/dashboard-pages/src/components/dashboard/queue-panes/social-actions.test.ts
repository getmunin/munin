import { describe, expect, it } from 'vitest';
import { socialPublishAvailability } from './social-actions';

const publishable = { canPublish: true };
const target = { userId: 'usr_1', externalAccountId: 'ext_1', displayName: 'Ola Nordmann' };

describe('socialPublishAvailability', () => {
  it('offers publishing when the viewer has an account on a platform Munin can post to', () => {
    expect(socialPublishAvailability(publishable, target)).toEqual({
      state: 'ready',
      authorName: 'Ola Nordmann',
    });
  });

  it('is ready even when the connected account has no display name', () => {
    expect(socialPublishAvailability(publishable, { ...target, displayName: null })).toEqual({
      state: 'ready',
      authorName: null,
    });
  });

  it('separates a viewer with no account from one whose account has not loaded yet', () => {
    expect(socialPublishAvailability(publishable, null).state).toBe('needsAccount');
    expect(socialPublishAvailability(publishable, undefined).state).toBe('loading');
  });

  it('never offers publishing for a platform Munin cannot post to, account or not', () => {
    expect(socialPublishAvailability({ canPublish: false }, target).state).toBe('unsupported');
    expect(socialPublishAvailability({ canPublish: false }, null).state).toBe('unsupported');
    expect(socialPublishAvailability({ canPublish: false }, undefined).state).toBe('unsupported');
  });
});
