import { describe, it, expect } from 'vitest';
import { entryTitle, readLiveUrlTemplate, renderLiveUrl } from './cms.live-url.ts';

describe('readLiveUrlTemplate', () => {
  it('reads a non-empty string template for every locale', () => {
    expect(readLiveUrlTemplate({ liveUrl: ' https://x/{slug} ' }, 'nb-NO')).toBe(
      'https://x/{slug}',
    );
  });

  it('treats blank, missing and unusable values as unset', () => {
    expect(readLiveUrlTemplate({}, 'nb-NO')).toBeNull();
    expect(readLiveUrlTemplate({ liveUrl: '   ' }, 'nb-NO')).toBeNull();
    expect(readLiveUrlTemplate({ liveUrl: 42 }, 'nb-NO')).toBeNull();
    expect(readLiveUrlTemplate({ liveUrl: null }, 'nb-NO')).toBeNull();
    expect(readLiveUrlTemplate({ liveUrl: ['https://x/{slug}'] }, 'nb-NO')).toBeNull();
  });

  it('picks the entry locale out of a per-locale map', () => {
    const settings = {
      liveUrl: {
        'nb-NO': 'https://threll.ai/no/blog/{slug}',
        'sv-SE': 'https://threll.ai/sv/blog/{slug}',
      },
    };
    expect(readLiveUrlTemplate(settings, 'nb-NO')).toBe('https://threll.ai/no/blog/{slug}');
    expect(readLiveUrlTemplate(settings, 'sv-SE')).toBe('https://threll.ai/sv/blog/{slug}');
  });

  it('matches a locale key regardless of case', () => {
    expect(
      readLiveUrlTemplate({ liveUrl: { 'nb-no': 'https://threll.ai/no/blog/{slug}' } }, 'nb-NO'),
    ).toBe('https://threll.ai/no/blog/{slug}');
  });

  it('falls back to the default key for a locale the map does not name', () => {
    const settings = {
      liveUrl: { 'nb-NO': 'https://threll.ai/no/blog/{slug}', default: 'https://threll.ai/en/blog/{slug}' },
    };
    expect(readLiveUrlTemplate(settings, 'da-DK')).toBe('https://threll.ai/en/blog/{slug}');
  });

  it('leaves a locale unlinked when the map names neither it nor a default', () => {
    expect(
      readLiveUrlTemplate({ liveUrl: { 'nb-NO': 'https://threll.ai/no/blog/{slug}' } }, 'da-DK'),
    ).toBeNull();
  });

  it('skips a blank locale entry rather than treating it as a match', () => {
    expect(
      readLiveUrlTemplate({ liveUrl: { 'nb-NO': '  ', default: 'https://x/{slug}' } }, 'nb-NO'),
    ).toBe('https://x/{slug}');
  });
});

describe('renderLiveUrl', () => {
  const entry = { slug: 'spring menu', locale: 'nb', collectionSlug: 'blog' };

  it('substitutes and percent-encodes every placeholder', () => {
    expect(
      renderLiveUrl('https://www.example.com/{locale}/{collection}/{slug}', entry),
    ).toBe('https://www.example.com/nb/blog/spring%20menu');
  });

  it('returns null without a template', () => {
    expect(renderLiveUrl(null, entry)).toBeNull();
  });

  it('returns null when the template does not produce an http(s) URL', () => {
    expect(renderLiveUrl('/blog/{slug}', entry)).toBeNull();
    expect(renderLiveUrl('javascript:alert(1)', entry)).toBeNull();
  });
});

describe('entryTitle', () => {
  it('prefers the first populated title-ish field', () => {
    expect(entryTitle({ headline: 'Headline', title: ' Title ' }, 'slug')).toBe('Title');
    expect(entryTitle({ headline: 'Headline' }, 'slug')).toBe('Headline');
    expect(entryTitle({ name: 'Name' }, 'slug')).toBe('Name');
  });

  it('falls back to the slug when no title field carries text', () => {
    expect(entryTitle({ title: '  ', body: 'text' }, 'spring-menu')).toBe('spring-menu');
  });
});
