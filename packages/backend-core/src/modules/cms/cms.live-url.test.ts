import { describe, it, expect } from 'vitest';
import { entryTitle, readLiveUrlTemplate, renderLiveUrl } from './cms.live-url.ts';

describe('readLiveUrlTemplate', () => {
  it('reads a non-empty string template', () => {
    expect(readLiveUrlTemplate({ liveUrl: ' https://x/{slug} ' })).toBe('https://x/{slug}');
  });

  it('treats blank, missing and non-string values as unset', () => {
    expect(readLiveUrlTemplate({})).toBeNull();
    expect(readLiveUrlTemplate({ liveUrl: '   ' })).toBeNull();
    expect(readLiveUrlTemplate({ liveUrl: 42 })).toBeNull();
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
