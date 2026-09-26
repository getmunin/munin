import { describe, it, expect } from 'vitest';
import { decodeHtmlEntities, teamsHtmlToMarkdown } from './teams-html-inbound.ts';

describe('teamsHtmlToMarkdown', () => {
  it('passes plain text through with entities decoded', () => {
    expect(teamsHtmlToMarkdown('Fish &amp; chips')).toBe('Fish & chips');
  });

  it('drops the bot mention and keeps other mentions as @names', () => {
    const html = '<p><at>Munin</at>&nbsp;please loop in <at>Kari Nordmann</at></p>';
    expect(teamsHtmlToMarkdown(html, { dropMentions: ['Munin'] })).toBe(
      'please loop in @Kari Nordmann',
    );
  });

  it('never lets a mention name smuggle angle brackets through nested tags', () => {
    expect(teamsHtmlToMarkdown('<at><scr<b>ipt>Kari</at> hi')).not.toMatch(/[<>]/);
    expect(teamsHtmlToMarkdown('<at>&lt;script&gt;Kari</at> hi')).toBe('@scriptKari hi');
  });

  it('converts inline formatting to markdown', () => {
    expect(teamsHtmlToMarkdown('<p><strong>Bold</strong>, <em>soft</em> and <s>gone</s></p>')).toBe(
      '**Bold**, _soft_ and ~~gone~~',
    );
  });

  it('keeps paragraphs and line breaks', () => {
    expect(teamsHtmlToMarkdown('<p>Hi</p><p>Line one<br>Line two</p>')).toBe(
      'Hi\n\nLine one\nLine two',
    );
  });

  it('turns links into markdown links and collapses self-labelled ones', () => {
    expect(
      teamsHtmlToMarkdown(
        '<p>See <a href="https://example.com/help">the guide</a> or <a href="https://example.com">https://example.com</a></p>',
      ),
    ).toBe('See [the guide](https://example.com/help) or https://example.com');
  });

  it('drops javascript: links but keeps their text', () => {
    expect(teamsHtmlToMarkdown('<p><a href="javascript:alert(1)">click</a></p>')).toBe('click');
  });

  it('renders lists and code blocks', () => {
    expect(teamsHtmlToMarkdown('<ul><li>One</li><li>Two</li></ul>')).toBe('- One\n- Two');
    expect(teamsHtmlToMarkdown('<pre><code>a  b\nc</code></pre>')).toBe('```\na  b\nc\n```');
  });

  it('uses the alt text of Teams emoji', () => {
    expect(teamsHtmlToMarkdown('<p>Thanks <emoji id="smile" alt="😄" title="Smile"></emoji></p>')).toBe(
      'Thanks 😄',
    );
  });

  it('strips unknown tags', () => {
    expect(teamsHtmlToMarkdown('<div><span style="color:red">Careful</span></div>')).toBe('Careful');
  });
});

describe('decodeHtmlEntities', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeHtmlEntities('&lt;b&gt; &#229; &#xE6; &quot;x&quot;')).toBe('<b> å æ "x"');
  });

  it('leaves unknown entities alone', () => {
    expect(decodeHtmlEntities('&unknown; &#xFFFFFFF;')).toBe('&unknown; &#xFFFFFFF;');
  });
});
