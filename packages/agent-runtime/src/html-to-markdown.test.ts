import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from './html-to-markdown.ts';

describe('htmlToMarkdown', () => {
  it('returns text without known tags untouched', () => {
    const source = 'Hei!\n\n* **Billån:** juster selv\n* **Kreditt:** kontakt banken\n\nMed vennlig hilsen,\nAcme';
    expect(htmlToMarkdown(source)).toBe(source);
  });

  it('leaves autolinks, addresses and comparisons alone', () => {
    const source = 'Skriv til <kari@example.com> eller se <https://example.com/hjelp>. 2 < 3 > 1.';
    expect(htmlToMarkdown(source)).toBe(source);
  });

  it('converts an indented HTML list mixed into a plain-text reply', () => {
    const source = [
      'Det er flott å høre.',
      '',
      'Her er stegene:',
      '',
      '<ul>',
      '    <li><strong>Få oversikt:</strong> Logg inn med BankID.</li>',
      '    <li><strong>Sjekk scoren:</strong> Se hva som påvirker den.</li>',
      '</ul>',
      '',
      'Med vennlig hilsen,',
      'Acme',
    ].join('\n');
    expect(htmlToMarkdown(source)).toBe(
      [
        'Det er flott å høre.',
        '',
        'Her er stegene:',
        '',
        '- **Få oversikt:** Logg inn med BankID.',
        '- **Sjekk scoren:** Se hva som påvirker den.',
        '',
        'Med vennlig hilsen,',
        'Acme',
      ].join('\n'),
    );
  });

  it('turns paragraphs and line breaks into blank lines and newlines', () => {
    expect(htmlToMarkdown('<p>Hei Kari,</p>\n<p>Takk for at du tok kontakt.<br>Vi ser på saken.</p>')).toBe(
      'Hei Kari,\n\nTakk for at du tok kontakt.\nVi ser på saken.',
    );
  });

  it('numbers ordered lists and indents nested ones under their parent', () => {
    expect(
      htmlToMarkdown('<ol><li>Logg inn<ul><li>BankID</li><li>Vipps</li></ul></li><li>Velg gjeld</li></ol>'),
    ).toBe('1. Logg inn\n   - BankID\n   - Vipps\n2. Velg gjeld');
  });

  it('keeps list items on one line when the model wraps them in paragraphs', () => {
    expect(htmlToMarkdown('<ul>\n  <li>\n    <p>Første punkt</p>\n  </li>\n</ul>')).toBe('- Første punkt');
  });

  it('moves whitespace outside emphasis markers so they still render', () => {
    expect(htmlToMarkdown('Dette er <strong> viktig </strong>, og <em>dette</em> også.')).toBe(
      'Dette er **viktig** , og *dette* også.',
    );
  });

  it('drops empty emphasis', () => {
    expect(htmlToMarkdown('Hei<b></b> der')).toBe('Hei der');
  });

  it('renders headings as bold paragraphs', () => {
    expect(htmlToMarkdown('<h3>Neste steg</h3>Logg inn.')).toBe('**Neste steg**\n\nLogg inn.');
  });

  it('converts safe links and keeps only the label of unsafe ones', () => {
    expect(
      htmlToMarkdown(
        'Les <a href="https://example.com/a?x=1&amp;y=2">guiden</a>, <a href="https://example.com">https://example.com</a> eller <a href="javascript:alert(1)">dette</a>.',
      ),
    ).toBe('Les [guiden](https://example.com/a?x=1&y=2), https://example.com eller dette.');
  });

  it('decodes entities once HTML is present', () => {
    expect(htmlToMarkdown('<p>Pris:&nbsp;100&nbsp;kr &amp; gebyr &lt;5%</p>')).toBe('Pris: 100 kr & gebyr <5%');
  });

  it('does not touch HTML inside code spans or fenced blocks', () => {
    const source = 'Lim inn <b>dette</b>:\n\n```html\n<script src="https://example.com/widget.js"></script>\n<p>hei</p>\n```\n\nEller `<br>` inline.';
    expect(htmlToMarkdown(source)).toBe(
      'Lim inn **dette**:\n\n```html\n<script src="https://example.com/widget.js"></script>\n<p>hei</p>\n```\n\nEller `<br>` inline.',
    );
  });

  it('leaves tags it does not know in place for the channel renderer to escape', () => {
    expect(htmlToMarkdown('<b>Merk:</b> <script>x()</script>')).toBe('**Merk:** <script>x()</script>');
  });
});
