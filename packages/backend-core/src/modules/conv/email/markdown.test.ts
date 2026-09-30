import { describe, expect, it } from 'vitest';
import { renderEmailHtml, renderMarkdownToHtml, renderQuotedHistoryHtml } from './markdown.ts';
import type { QuotedPriorMessage } from './reply-history.ts';

const HOSTILE_INPUTS: Array<[string, string]> = [
  ['an anchor tag', '<a href="https://evil.example">https://bank.example</a>'],
  ['a hidden div', '<div style="display:none">hidden instructions</div>'],
  ['a script tag', '<script>alert(1)</script>'],
  ['an img with an onerror handler', '<img src=x onerror="alert(1)">'],
  ['a javascript: markdown link', '[click me](javascript:alert(1))'],
  ['a javascript: autolink', '<javascript:alert(1)>'],
  ['a data: markdown image', '![pic](data:text/html;base64,PHNjcmlwdD4=)'],
  ['an entity-encoded javascript: link', '[click me](javascript&#58;alert(1))'],
  ['a vbscript: link', '[click me](vbscript:msgbox(1))'],
  ['a javascript: link split by a tab entity', '[click me](java&tab;script:alert(1))'],
];

function priorFrom(body: string): QuotedPriorMessage[] {
  return [
    {
      authorName: 'Kari Nordmann',
      authorEmail: 'kari@example.com',
      createdAt: new Date('2026-01-02T03:04:05Z'),
      body,
    },
  ];
}

function assertInert(html: string): void {
  expect(html).not.toMatch(/<a\s[^>]*href="(?!https?:|mailto:)[a-z]+:/i);
  expect(html).not.toMatch(/href="https:\/\/evil\.example"/);
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/<div style=/i);
  expect(html).not.toMatch(/<img[^>]*onerror/i);
  expect(html).not.toMatch(/src="data:/i);
  expect(html).not.toMatch(/href="javascript/i);
  expect(html).not.toMatch(/href="vbscript/i);
}

describe('renderMarkdownToHtml escapes raw HTML and unsafe URLs', () => {
  it.each(HOSTILE_INPUTS)('renders %s in the outgoing body as inert text', (_label, input) => {
    assertInert(renderMarkdownToHtml(input));
  });

  it.each(HOSTILE_INPUTS)('renders %s in quoted history as inert text', (_label, input) => {
    assertInert(renderQuotedHistoryHtml(priorFrom(input)));
  });

  it.each(HOSTILE_INPUTS)('renders %s inert in the full email document', (_label, input) => {
    assertInert(renderEmailHtml(input, priorFrom(input)));
  });

  it('shows raw HTML tags to the recipient as literal text', () => {
    const html = renderMarkdownToHtml('see <b>this</b>');
    expect(html).toContain('&lt;b&gt;this&lt;/b&gt;');
  });

  it('keeps the visible text of a link whose URL scheme is refused', () => {
    const html = renderMarkdownToHtml('[click me](javascript:alert(1))');
    expect(html).toContain('click me');
    expect(html).not.toContain('<a');
  });

  it('keeps the alt text of an image whose URL scheme is refused', () => {
    const html = renderMarkdownToHtml('![a picture](data:image/png;base64,AAAA)');
    expect(html).toContain('a picture');
    expect(html).not.toContain('<img');
  });
});

describe('renderMarkdownToHtml still renders ordinary markdown', () => {
  it('renders bold and emphasis', () => {
    expect(renderMarkdownToHtml('**bold** and _em_')).toContain('<strong>bold</strong> and <em>em</em>');
  });

  it('renders bullet lists', () => {
    const html = renderMarkdownToHtml('- one\n- two');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<li>two</li>');
  });

  it('renders https, mailto and relative links as anchors', () => {
    expect(renderMarkdownToHtml('[docs](https://example.com/a?b=1&c=2)')).toContain(
      '<a href="https://example.com/a?b=1&amp;c=2">docs</a>',
    );
    expect(renderMarkdownToHtml('[mail](mailto:support@example.com)')).toContain(
      '<a href="mailto:support@example.com">mail</a>',
    );
    expect(renderMarkdownToHtml('[help](/help/start)')).toContain('<a href="/help/start">help</a>');
  });

  it('renders bare URLs as anchors', () => {
    expect(renderMarkdownToHtml('go to https://example.com now')).toContain(
      '<a href="https://example.com">https://example.com</a>',
    );
  });

  it('renders https and cid images', () => {
    expect(renderMarkdownToHtml('![logo](https://example.com/logo.png)')).toContain(
      '<img src="https://example.com/logo.png" alt="logo">',
    );
    expect(renderMarkdownToHtml('![shot](cid:shot@example.com)')).toContain(
      '<img src="cid:shot@example.com" alt="shot">',
    );
  });

  it('renders inline code and code blocks with their contents escaped', () => {
    expect(renderMarkdownToHtml('use `<tag>`')).toContain('<code>&lt;tag&gt;</code>');
    expect(renderMarkdownToHtml('```\n<b>x</b>\n```')).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('turns single newlines into line breaks', () => {
    expect(renderMarkdownToHtml('line one\nline two')).toContain('line one<br>line two');
  });
});
