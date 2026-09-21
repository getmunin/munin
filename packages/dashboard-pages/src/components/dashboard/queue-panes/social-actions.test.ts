import { describe, expect, it } from 'vitest';
import {
  shortPublishName,
  socialMediaKind,
  socialPublishAvailability,
  type SocialPublishTarget,
} from './social-actions';

const draft = { canPublish: true, platform: 'linkedin' };

const member: SocialPublishTarget = {
  userId: 'usr_1',
  platform: 'linkedin',
  authorKind: 'member',
  externalAccountId: 'ext_1',
  displayName: 'Ola Nordmann',
};

const page: SocialPublishTarget = {
  userId: 'usr_1',
  platform: 'facebook',
  authorKind: 'org_page',
  externalAccountId: 'ext_2',
  displayName: 'Acme',
};

describe('socialPublishAvailability', () => {
  it('offers publishing when the viewer has an account on a platform Munin can post to', () => {
    expect(socialPublishAvailability(draft, [member])).toEqual({
      state: 'ready',
      authorName: 'Ola Nordmann',
      authorKind: 'member',
    });
  });

  it('picks the account belonging to the draft’s own platform', () => {
    expect(socialPublishAvailability({ canPublish: true, platform: 'facebook' }, [member, page])).toEqual({
      state: 'ready',
      authorName: 'Acme',
      authorKind: 'org_page',
    });
  });

  it('asks for an account when the viewer has connected a different platform only', () => {
    expect(
      socialPublishAvailability({ canPublish: true, platform: 'facebook' }, [member]).state,
    ).toBe('needsAccount');
  });

  it('is ready even when the connected account has no display name', () => {
    expect(socialPublishAvailability(draft, [{ ...member, displayName: null }])).toEqual({
      state: 'ready',
      authorName: null,
      authorKind: 'member',
    });
  });

  it('separates a viewer with no account from one whose accounts have not loaded yet', () => {
    expect(socialPublishAvailability(draft, []).state).toBe('needsAccount');
    expect(socialPublishAvailability(draft, null).state).toBe('needsAccount');
    expect(socialPublishAvailability(draft, undefined).state).toBe('loading');
  });

  it('never offers publishing for a platform Munin cannot post to, account or not', () => {
    const cannot = { canPublish: false, platform: 'linkedin' };
    expect(socialPublishAvailability(cannot, [member]).state).toBe('unsupported');
    expect(socialPublishAvailability(cannot, []).state).toBe('unsupported');
    expect(socialPublishAvailability(cannot, undefined).state).toBe('unsupported');
  });
});

describe('shortPublishName', () => {
  it('keeps a name that already fits on the button', () => {
    expect(shortPublishName('Ola Nordmann')).toBe('Ola Nordmann');
    expect(shortPublishName('Acme')).toBe('Acme');
  });

  it('falls back to the first name when a person’s full name would overflow', () => {
    expect(shortPublishName('Kari Nordmann-Berg')).toBe('Kari');
    expect(shortPublishName('Globex Corporation')).toBe('Globex');
  });

  it('truncates a page name instead of clipping it to its first word', () => {
    expect(shortPublishName('Globex Corporation', 'org_page')).toBe('Globex Corp…');
    expect(shortPublishName('Acme Nordic', 'org_page')).toBe('Acme Nordic');
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

describe('socialMediaKind', () => {
  it('trusts the stored kind over the file extension', () => {
    expect(socialMediaKind({ mediaKind: 'video', mediaUrl: 'https://cdn.example/a.png' })).toBe(
      'video',
    );
  });

  it('reads a video extension when the kind is missing', () => {
    expect(socialMediaKind({ mediaKind: null, mediaUrl: 'https://cdn.example/clip.mp4?v=2' })).toBe(
      'video',
    );
  });

  it('falls back to image for anything else', () => {
    expect(socialMediaKind({ mediaKind: null, mediaUrl: 'https://cdn.example/photo.jpg' })).toBe(
      'image',
    );
  });

  it('reports nothing when there is no media', () => {
    expect(socialMediaKind({ mediaKind: null, mediaUrl: null })).toBeNull();
  });
});
