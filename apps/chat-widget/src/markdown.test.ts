import { describe, expect, it } from 'vitest';
import { renderMarkdownInto } from './markdown.js';

function render(source: string): string {
  const host = document.createElement('div');
  renderMarkdownInto(host, source);
  return host.innerHTML;
}

describe('renderMarkdownInto', () => {
  it('renders a plain paragraph', () => {
    expect(render('Hello world')).toBe('<p>Hello world</p>');
  });

  it('renders **bold** as strong', () => {
    expect(render('This is **Apps Consulting** today')).toBe(
      '<p>This is <strong>Apps Consulting</strong> today</p>',
    );
  });

  it('renders *italic* as em', () => {
    expect(render('*ahem* really')).toBe('<p><em>ahem</em> really</p>');
  });

  it('renders `inline code`', () => {
    expect(render('Run `pnpm test`')).toBe('<p>Run <code>pnpm test</code></p>');
  });

  it('renders a safe link with target/rel', () => {
    const host = document.createElement('div');
    renderMarkdownInto(host, 'See [docs](https://example.com)');
    const a = host.querySelector('a');
    expect(a).not.toBeNull();
    expect(a!.getAttribute('href')).toBe('https://example.com');
    expect(a!.getAttribute('target')).toBe('_blank');
    expect(a!.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a!.textContent).toBe('docs');
  });

  it('rejects javascript: URLs', () => {
    expect(render('See [bad](javascript:alert(1))')).toBe(
      '<p>See [bad](javascript:alert(1))</p>',
    );
  });

  it('escapes raw HTML by never using innerHTML for text', () => {
    expect(render('Hello <script>alert(1)</script>')).toBe(
      '<p>Hello &lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );
  });

  it('handles bullet lists', () => {
    expect(render('- one\n- two\n- three')).toBe(
      '<ul><li>one</li><li>two</li><li>three</li></ul>',
    );
  });

  it('handles numbered lists', () => {
    expect(render('1. one\n2. two')).toBe('<ol><li>one</li><li>two</li></ol>');
  });

  it('handles fenced code blocks with language', () => {
    expect(render('```ts\nconst x = 1;\n```')).toBe(
      '<pre><code data-language="ts">const x = 1;</code></pre>',
    );
  });

  it('preserves single newlines within a paragraph as <br>', () => {
    expect(render('line one\nline two')).toBe('<p>line one<br>line two</p>');
  });

  it('separates paragraphs on blank lines', () => {
    expect(render('first\n\nsecond')).toBe('<p>first</p><p>second</p>');
  });

  it('does not interpret asterisks inside words as italic', () => {
    expect(render('foo*bar*baz')).toBe('<p>foo*bar*baz</p>');
  });

  it('handles nested bold inside list items', () => {
    expect(render('- a **bold** thing\n- next')).toBe(
      '<ul><li>a <strong>bold</strong> thing</li><li>next</li></ul>',
    );
  });

  it('treats unclosed bold as literal asterisks', () => {
    expect(render('this has **no close')).toBe('<p>this has **no close</p>');
  });

  it('handles backslash escapes for markdown markers', () => {
    expect(render('not \\*italic\\* here')).toBe('<p>not *italic* here</p>');
  });
});
