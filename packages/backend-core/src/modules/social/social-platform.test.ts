import { describe, it, expect } from 'vitest';
import {
  applyUtm,
  buildUtm,
  describePlatform,
  isSocialPlatform,
  measureBody,
} from './social-platform.ts';

describe('measureBody', () => {
  it('does not charge a LinkedIn post for the characters its link costs', () => {
    const link = 'https://example.test/a-fairly-long-article-slug-that-eats-characters';
    const body = `A short thought. ${link}`;
    const measured = measureBody('linkedin', body, null);
    expect(measured.bodyChars).toBe(body.length);
    expect(measured.countedChars).toBe(body.length - link.length);
    expect(measured.overBy).toBe(0);
  });

  it('reports how far over the limit a body runs', () => {
    const limit = describePlatform('linkedin').limits.maxBodyChars;
    const measured = measureBody('linkedin', 'x'.repeat(limit + 42), null);
    expect(measured.overBy).toBe(42);
  });

  it('counts an attached link alongside any inline ones', () => {
    const measured = measureBody(
      'linkedin',
      'see https://example.test/one and https://example.test/two',
      'https://example.test/three',
    );
    expect(measured.linkCount).toBe(3);
    expect(measured.maxLinks).toBe(1);
  });

  it('treats a body with no links as costing its full length', () => {
    const measured = measureBody('linkedin', 'plain text, no links at all', null);
    expect(measured.countedChars).toBe(measured.bodyChars);
    expect(measured.linkCount).toBe(0);
  });
});

describe('utm', () => {
  it('distinguishes variants of one set by utm_content alone', () => {
    const a = buildUtm('linkedin', 'spd_set', 'practitioner');
    const b = buildUtm('linkedin', 'spd_set', 'contrarian');
    expect(a.utm_campaign).toBe(b.utm_campaign);
    expect(a.utm_source).toBe('linkedin');
    expect(a.utm_medium).toBe('social');
    expect(a.utm_content).not.toBe(b.utm_content);
  });

  it('adds parameters without disturbing the ones already on the URL', () => {
    const tagged = applyUtm(
      'https://example.test/post?ref=newsletter',
      buildUtm('linkedin', 'spd_set', 'story'),
    );
    const params = new URL(tagged).searchParams;
    expect(params.get('ref')).toBe('newsletter');
    expect(params.get('utm_content')).toBe('story');
    expect(params.get('utm_campaign')).toBe('spd_set');
  });

  it('overwrites a utm parameter the caller already put on the URL', () => {
    const tagged = applyUtm(
      'https://example.test/post?utm_source=twitter',
      buildUtm('linkedin', 'spd_set', 'data'),
    );
    expect(new URL(tagged).searchParams.get('utm_source')).toBe('linkedin');
  });
});

describe('isSocialPlatform', () => {
  it('accepts a known platform and rejects anything else', () => {
    expect(isSocialPlatform('linkedin')).toBe(true);
    expect(isSocialPlatform('mastodon')).toBe(false);
  });
});
