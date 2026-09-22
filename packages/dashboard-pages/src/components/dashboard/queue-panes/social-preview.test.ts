import { describe, expect, it } from 'vitest';
import {
  composePreviewBody,
  countBodyChars,
  composePreviewComment,
  foldPreviewBody,
  linkHost,
  previewLink,
  splitUrls,
  type SocialPreviewDraft,
} from './social-preview';

const draft: SocialPreviewDraft = {
  platform: 'linkedin',
  body: 'Most knowledge bases rot.',
  linkUrl: 'https://example.test/blog/self-writing-knowledge-base',
  shareUrl: 'https://example.test/blog/self-writing-knowledge-base?utm_source=linkedin',
  linkPlacement: 'body',
  linkCommentText: null,
  mediaUrl: null,
};

describe('previewLink', () => {
  it('prefers the tagged share url over the bare link', () => {
    expect(previewLink(draft)).toBe(draft.shareUrl);
  });

  it('falls back to the bare link when nothing was tagged', () => {
    expect(previewLink({ ...draft, shareUrl: null })).toBe(draft.linkUrl);
  });
});

describe('composePreviewBody', () => {
  it('appends the link the way the adapter does when it is placed in the body', () => {
    expect(composePreviewBody(draft)).toBe(`${draft.body}\n\n${draft.shareUrl}`);
  });

  it('leaves the body alone when it already carries the link', () => {
    const body = `Read it: ${draft.shareUrl}`;
    expect(composePreviewBody({ ...draft, body })).toBe(body);
  });

  it('keeps the link out of the body when it goes in a comment', () => {
    expect(composePreviewBody({ ...draft, linkPlacement: 'comment' })).toBe(draft.body);
  });

  it('leaves a post with no link untouched', () => {
    expect(composePreviewBody({ ...draft, linkUrl: null, shareUrl: null })).toBe(draft.body);
  });

  it('keeps the link out of a bare Facebook post, where the card carries it instead', () => {
    expect(composePreviewBody({ ...draft, platform: 'facebook' })).toBe(draft.body);
  });

  it('appends the link to a Facebook post that carries a picture, as the adapter does', () => {
    const withMedia = { ...draft, platform: 'facebook', mediaUrl: 'https://example.test/a.png' };
    expect(composePreviewBody(withMedia)).toBe(`${draft.body}\n\n${draft.shareUrl}`);
  });
});

describe('composePreviewComment', () => {
  it('is nothing when the link rides in the body', () => {
    expect(composePreviewComment(draft)).toBeNull();
  });

  it('is the bare link when no comment text was written', () => {
    expect(composePreviewComment({ ...draft, linkPlacement: 'comment' })).toBe(draft.shareUrl);
  });

  it('appends the link under the comment text', () => {
    const comment = composePreviewComment({
      ...draft,
      linkPlacement: 'comment',
      linkCommentText: 'Full write-up here:',
    });
    expect(comment).toBe(`Full write-up here:\n\n${draft.shareUrl}`);
  });

  it('does not repeat a link the comment text already spells out', () => {
    const linkCommentText = `Full write-up: ${draft.shareUrl}`;
    expect(composePreviewComment({ ...draft, linkPlacement: 'comment', linkCommentText })).toBe(
      linkCommentText,
    );
  });
});

describe('foldPreviewBody', () => {
  it('leaves a short post unfolded', () => {
    expect(foldPreviewBody('linkedin', 'Short enough.')).toEqual({
      head: 'Short enough.',
      folded: false,
    });
  });

  it('folds LinkedIn earlier than Facebook', () => {
    const body = 'word '.repeat(120).trim();
    const linkedin = foldPreviewBody('linkedin', body);
    const facebook = foldPreviewBody('facebook', body);
    expect(linkedin.folded).toBe(true);
    expect(facebook.folded).toBe(true);
    expect(linkedin.head.length).toBeLessThan(facebook.head.length);
  });

  it('cuts on a word boundary, never mid-word', () => {
    const body = 'alpha '.repeat(60).trim();
    const { head } = foldPreviewBody('linkedin', body);
    expect(body.startsWith(head)).toBe(true);
    expect(head.endsWith('alpha')).toBe(true);
  });

  it('hard-cuts a single unbroken run of characters', () => {
    const body = 'x'.repeat(400);
    const { head, folded } = foldPreviewBody('linkedin', body);
    expect(folded).toBe(true);
    expect(head).toHaveLength(210);
  });

  it('folds an unknown platform on its own default', () => {
    expect(foldPreviewBody('mastodon', 'a'.repeat(100)).folded).toBe(false);
    expect(foldPreviewBody('mastodon', 'a'.repeat(400)).folded).toBe(true);
  });
});

describe('linkHost', () => {
  it('drops the www prefix', () => {
    expect(linkHost('https://www.example.test/blog')).toBe('example.test');
  });

  it('is nothing for a string that is not a url', () => {
    expect(linkHost('not a url')).toBeNull();
  });
});

describe('splitUrls', () => {
  it('keeps plain text in one part', () => {
    expect(splitUrls('no links here')).toEqual([{ text: 'no links here', url: false }]);
  });

  it('marks a link the networks would turn blue', () => {
    expect(splitUrls('read it: https://example.test/a now')).toEqual([
      { text: 'read it: ', url: false },
      { text: 'https://example.test/a', url: true },
      { text: ' now', url: false },
    ]);
  });

  it('marks every link in the text, not just the first', () => {
    const parts = splitUrls('https://example.test/a and https://example.test/b');
    expect(parts.filter((p) => p.url).map((p) => p.text)).toEqual([
      'https://example.test/a',
      'https://example.test/b',
    ]);
  });
});

describe('countBodyChars', () => {
  it('counts every character on a platform where links count', () => {
    expect(countBodyChars('facebook', 'see https://example.test/a')).toBe(26);
  });

  it('leaves link characters out on LinkedIn, which shortens them', () => {
    expect(countBodyChars('linkedin', 'see https://example.test/a')).toBe(4);
  });

  it('counts every link in the body, not just the first', () => {
    expect(countBodyChars('linkedin', 'https://example.test/a https://example.test/b')).toBe(1);
  });

  it('counts plainly for a platform it has no rule for', () => {
    expect(countBodyChars('mastodon', 'https://example.test/a')).toBe(22);
  });
});
