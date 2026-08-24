import { describe, it, expect } from 'vitest';
import { escapeSlackText, markdownToMrkdwn } from './slack-mrkdwn.ts';

describe('escapeSlackText', () => {
  it('escapes mrkdwn control characters', () => {
    expect(escapeSlackText('a <b> & c')).toBe('a &lt;b&gt; &amp; c');
  });
});

describe('markdownToMrkdwn', () => {
  it('turns double-asterisk bold into single-asterisk bold', () => {
    expect(markdownToMrkdwn('**Slik fungerer det:**')).toBe('*Slik fungerer det:*');
    expect(markdownToMrkdwn('a **bold** b **also bold** c')).toBe(
      'a *bold* b *also bold* c',
    );
  });

  it('reads underscore bold as bold and single asterisks as italic', () => {
    expect(markdownToMrkdwn('__strong__ and *emphasis*')).toBe('*strong* and _emphasis_');
  });

  it('keeps bold inside a bulleted line', () => {
    expect(markdownToMrkdwn('- **Svare på spørsmål** basert på info')).toBe(
      '• *Svare på spørsmål* basert på info',
    );
  });

  it('renders headings as bold lines without stacking emphasis markers', () => {
    expect(markdownToMrkdwn('## Teknisk setup')).toBe('*Teknisk setup*');
    expect(markdownToMrkdwn('### **Teknisk setup**')).toBe('*Teknisk setup*');
  });

  it('rewrites bullets by nesting depth and preserves ordered lists', () => {
    expect(markdownToMrkdwn('- one\n  - two\n    - three\n1. first')).toBe(
      '• one\n  ◦ two\n    ▪ three\n1. first',
    );
  });

  it('renders task list markers as checkboxes', () => {
    expect(markdownToMrkdwn('- [ ] todo\n- [x] done')).toBe('• ☐ todo\n• ☑ done');
  });

  it('converts inline links, images and bare autolinks to Slack link syntax', () => {
    expect(markdownToMrkdwn('see [Threll.ai](https://threll.ai) now')).toBe(
      'see <https://threll.ai|Threll.ai> now',
    );
    expect(markdownToMrkdwn('[docs](https://x.dev/a "Title")')).toBe('<https://x.dev/a|docs>');
    expect(markdownToMrkdwn('![logo](https://x.dev/l.png)')).toBe('<https://x.dev/l.png|logo>');
    expect(markdownToMrkdwn('<https://x.dev/a>')).toBe('<https://x.dev/a>');
    expect(markdownToMrkdwn('[mail](hello@x.dev)')).toBe('<mailto:hello@x.dev|mail>');
  });

  it('drops the link wrapper when the target is not addressable', () => {
    expect(markdownToMrkdwn('[section](#anchor)')).toBe('section');
  });

  it('escapes ampersands inside link targets', () => {
    expect(markdownToMrkdwn('[q](https://x.dev/s?a=1&b=2)')).toBe(
      '<https://x.dev/s?a=1&amp;b=2|q>',
    );
  });

  it('collapses double tildes to Slack strikethrough', () => {
    expect(markdownToMrkdwn('~~gone~~')).toBe('~gone~');
  });

  it('leaves code spans and fences untouched, dropping the fence language', () => {
    expect(markdownToMrkdwn('use `a **b** c` here')).toBe('use `a **b** c` here');
    expect(markdownToMrkdwn('```ts\nconst a = b ** 2;\n```')).toBe(
      '```\nconst a = b ** 2;\n```',
    );
  });

  it('escapes mrkdwn control characters inside code as well as prose', () => {
    expect(markdownToMrkdwn('`a < b`')).toBe('`a &lt; b`');
    expect(markdownToMrkdwn('a & <b>')).toBe('a &amp; &lt;b&gt;');
  });

  it('drops horizontal rules and normalizes blockquotes', () => {
    expect(markdownToMrkdwn('a\n---\nb')).toBe('a\nb');
    expect(markdownToMrkdwn('>quoted')).toBe('> quoted');
  });

  it('does not leave a gaping hole where a horizontal rule was', () => {
    expect(markdownToMrkdwn('a\n\n---\n\nb')).toBe('a\n\nb');
  });

  it('unescapes backslash-escaped markdown punctuation', () => {
    expect(markdownToMrkdwn('a \\* b \\_c\\_')).toBe('a * b _c_');
  });

  it('leaves plain prose and stray asterisks alone', () => {
    expect(markdownToMrkdwn('2 * 3 = 6')).toBe('2 * 3 = 6');
    expect(markdownToMrkdwn('Hei! Hvordan går det?')).toBe('Hei! Hvordan går det?');
  });

  it('leaves an email signature dash separator intact', () => {
    expect(markdownToMrkdwn('Vennlig hilsen\n--\nEspen')).toBe('Vennlig hilsen\n--\nEspen');
  });
});
