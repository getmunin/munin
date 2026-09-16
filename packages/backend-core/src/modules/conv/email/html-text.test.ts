import { describe, expect, it } from 'vitest';
import { htmlToText } from './html-text.ts';
import { normalizeFlattenedWhitespace } from './inbound-body-limits.ts';
import { parseQuotedThread } from './quoted-thread.ts';
import { stripQuotedReplyText } from './reply-history.ts';

const NEWSLETTER_FORWARD_HTML = [
  '<!doctype html>',
  '<html><head><meta charset="utf-8"><title>Sesongens tilbud</title>',
  '<style>* { box-sizing: border-box; } body { margin: 0px; padding: 0px; }',
  '#MessageViewBody a { color: inherit; text-decoration: none; }</style>',
  '<!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96',
  '</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]--></head>',
  '<body><div>Sendt fra min iPad</div><div><br>',
  '<blockquote type="cite">Den 10. juli 2026 kl.&nbsp;00:04 skrev Nyhetsbrev',
  ' &lt;nyheter@example.test&gt;:<br><br>',
  '<div>Se hva abonnementet koster &#8212; helt gratis. ͏ ͏ ͏ ͏ ͏ ͏ ͏ ͏</div>',
  '<table><tr><td><p>Hei Ola!</p><p>Her er&nbsp;oversikten din.</p></td></tr>',
  '<tr><td><a href="https://example.test/se">Se oversikten</a></td></tr></table>',
  '</blockquote></div></body></html>',
].join('\n');

const FORWARD_CONTEXT = { forwardedSender: null, subject: 'Re: Sesongens tilbud' };

describe('htmlToText', () => {
  it('drops style, title and mso comment content instead of storing it as body text', () => {
    const text = htmlToText(NEWSLETTER_FORWARD_HTML);
    expect(text).not.toContain('box-sizing');
    expect(text).not.toContain('MessageViewBody');
    expect(text).not.toContain('PixelsPerInch');
    expect(text).not.toContain('96');
    expect(text).not.toContain('Sesongens tilbud');
  });

  it('drops script content', () => {
    expect(htmlToText('<p>Hei</p><script>var a = 1 < 2;</script>')).toBe('Hei');
  });

  it('turns block-level markup into line breaks so line-based quote parsing has lines to scan', () => {
    const text = htmlToText('<div>Takk!</div><div>Hei</div><p>Ha det</p><ul><li>ett</li><li>to</li></ul>');
    expect(text.split('\n')).toEqual(['Takk!', 'Hei', 'Ha det', 'ett', 'to']);
  });

  it('keeps table cells on separate lines', () => {
    const text = htmlToText('<table><tr><td>Beløp</td><td>199 kr</td></tr><tr><td>Sum</td></tr></table>');
    expect(text).toBe('Beløp\n199 kr\nSum');
  });

  it('reads an explicit line break as a blank line the way the sending client meant it', () => {
    expect(htmlToText('<div>Hei</div><div><br></div><div>Ha det</div>')).toBe('Hei\n\nHa det');
    expect(htmlToText('<div>Hei<br><br><br><br>Ha det</div>')).toBe('Hei\n\nHa det');
  });

  it('decodes the entities that hide the sender address inside an attribution line', () => {
    expect(htmlToText('Den 1. mai kl.&nbsp;09:00 skrev Kari &lt;kari@example.test&gt;:')).toBe(
      'Den 1. mai kl. 09:00 skrev Kari <kari@example.test>:',
    );
  });

  it('decodes named, decimal and hexadecimal character references', () => {
    expect(htmlToText('<p>R&aring;d &amp; tips &#8212; &#x27;n&#248;kkel&#x27;</p>')).toBe(
      "Råd & tips — 'nøkkel'",
    );
  });

  it('collapses source newlines and runs of spaces inside a line', () => {
    expect(htmlToText('<p>Hei   \n  der</p><div></div><div>Ha det</div>')).toBe('Hei der\nHa det');
  });

  it('drops the invisible padding characters newsletters use for preheader spacing', () => {
    expect(htmlToText('<div>Se tilbudet ͏ ͏ ͏​﻿</div>')).toBe('Se tilbudet');
  });

  it('leaves a character reference for the line-break sentinels undecoded so sender text cannot forge a line break', () => {
    expect(htmlToText('<p>Hei&#57344;der&#xe001;igjen</p>')).toBe('Hei&#57344;der&#xe001;igjen');
  });

  it('does not treat an unclosed angle bracket in body text as markup', () => {
    expect(htmlToText('<p>5 < 7 er sant</p>')).toBe('5 < 7 er sant');
  });

  it('returns an empty string for markup that carries no text', () => {
    expect(htmlToText('<html><head><style>a { color: red; }</style></head><body></body></html>')).toBe('');
  });
});

describe('an html-only forward of a newsletter', () => {
  it('yields one quoted turn with the newsletter sender', () => {
    const text = normalizeFlattenedWhitespace(htmlToText(NEWSLETTER_FORWARD_HTML));
    const turns = parseQuotedThread(text, FORWARD_CONTEXT);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.from).toBe('Nyhetsbrev <nyheter@example.test>');
    expect(turns[0]!.body).toContain('Hei Ola!');
    expect(turns[0]!.body).toContain('Her er oversikten din.');
  });

  it('leaves only the forwarder own words in the body', () => {
    const text = normalizeFlattenedWhitespace(htmlToText(NEWSLETTER_FORWARD_HTML));
    expect(stripQuotedReplyText(text, FORWARD_CONTEXT)).toBe('Sendt fra min iPad');
  });
});
