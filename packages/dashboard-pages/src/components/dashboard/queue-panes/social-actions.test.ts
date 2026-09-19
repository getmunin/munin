import { describe, expect, it } from 'vitest';
import { shortPublishName, socialPublishAvailability } from './social-actions';

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

describe('shortPublishName', () => {
  it('keeps a name that already fits on the button', () => {
    expect(shortPublishName('Ola Nordmann')).toBe('Ola Nordmann');
    expect(shortPublishName('Acme')).toBe('Acme');
  });

  it('falls back to the first name when the full name would overflow the button', () => {
    expect(shortPublishName('Kari Nordmann-Berg')).toBe('Kari');
    expect(shortPublishName('Globex Corporation')).toBe('Globex');
  });

  it('truncates a first name that overflows on its own', () => {
    expect(shortPublishName('Bartholomewsson Nordmann')).toBe('Bartholomew…');
  });

  it('collapses stray whitespace before measuring', () => {
    expect(shortPublishName('  Ola   Nordmann  ')).toBe('Ola Nordmann');
  });

  it('has no name to show when the account never reported one', () => {
    expect(shortPublishName(null)).toBeNull();
    expect(shortPublishName('   ')).toBeNull();
  });
});
