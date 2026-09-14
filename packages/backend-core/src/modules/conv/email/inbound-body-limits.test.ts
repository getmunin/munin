import { describe, expect, it } from 'vitest';
import {
  MAX_INBOUND_BODY_CHARS,
  clampInboundBody,
  collapseEncodedBlocks,
  normalizeFlattenedWhitespace,
} from './inbound-body-limits.ts';

const b64 = (n: number): string => 'U2FsdGVkX1+vR016HqB5QcbgGd5+4Eex4u6/2A6RhuuR0TsOhj9aUu1'.repeat(
  Math.ceil(n / 55),
).slice(0, n);

describe('collapseEncodedBlocks', () => {
  it('removes the wrapped base64 block a DSN echoes back, keeping the prose around it', () => {
    const body = [
      'Your message could not be delivered.',
      '',
      `X-HE-Meta: ${b64(76)}`,
      ...Array.from({ length: 38 }, () => b64(76)),
      b64(40),
      '',
      'Please try again later.',
    ].join('\n');

    const out = collapseEncodedBlocks(body);
    expect(out).toContain('Your message could not be delivered.');
    expect(out).toContain('Please try again later.');
    expect(out).toContain('lines of encoded data removed');
    expect(out).not.toContain('U2FsdGVkX1');
    expect(out.length).toBeLessThan(body.length / 4);
  });

  it('leaves ordinary prose untouched, including a couple of long sentences', () => {
    const body = [
      'Hi there,',
      '',
      'I ordered a replacement filter three weeks ago and it still has not turned up, so I would like to know whether it shipped at all.',
      '',
      'Best, Jane',
    ].join('\n');
    expect(collapseEncodedBlocks(body)).toBe(body);
  });

  it('absorbs the short tail line a wrapped block ends on', () => {
    const body = ['Delivery failed.', b64(76), b64(76), b64(76), b64(40), 'Regards'].join('\n');
    const out = collapseEncodedBlocks(body);
    expect(out).not.toContain('U2FsdGVkX1');
    expect(out).toContain('Regards');
  });

  it('does not swallow a long ordinary word that happens to follow encoded data', () => {
    const body = [b64(76), b64(76), b64(76), 'internationalization', 'done'].join('\n');
    const out = collapseEncodedBlocks(body);
    expect(out).toContain('internationalization');
    expect(out).toContain('done');
  });

  it('keeps a short encoded run rather than eating two lines of real content', () => {
    const body = ['Reference:', b64(70), 'thanks'].join('\n');
    const out = collapseEncodedBlocks(body);
    expect(out).toContain('thanks');
    expect(out).not.toContain('lines of encoded data removed');
  });

  it('collapses one very long unwrapped token in place', () => {
    const out = collapseEncodedBlocks(`token=${b64(1200)} end`);
    expect(out).toContain('[encoded data removed]');
    expect(out).toContain('end');
    expect(out.length).toBeLessThan(120);
  });

  it('does not mistake a long URL-bearing line of prose for encoded data', () => {
    const line = `See https://acme.example.com/orders/${b64(70)} for the tracking page and let us know`;
    expect(collapseEncodedBlocks(line)).toBe(line);
  });
});

describe('clampInboundBody', () => {
  it('caps a body that is long even after the encoded blocks come out', () => {
    const body = 'word '.repeat(MAX_INBOUND_BODY_CHARS);
    const out = clampInboundBody(body);
    expect(out.length).toBeLessThan(MAX_INBOUND_BODY_CHARS + 200);
    expect(out).toContain('more characters were not stored');
  });

  it('leaves a normal-sized message exactly as it was', () => {
    expect(clampInboundBody('Hei, kan dere sende faktura på nytt?')).toBe(
      'Hei, kan dere sende faktura på nytt?',
    );
  });
});

describe('normalizeFlattenedWhitespace', () => {
  it('collapses the runs of whitespace-only lines HTML-to-text flattening produces', () => {
    const body = ['Hei,', ' ', ' ', ' ', '   ', 'Takk for hjelpen.'].join('\n');
    expect(normalizeFlattenedWhitespace(body)).toBe('Hei,\n\nTakk for hjelpen.');
  });

  it('drops leading and trailing blank lines', () => {
    expect(normalizeFlattenedWhitespace('  \n \nHei,\n \n  \n')).toBe('Hei,');
  });

  it('strips trailing whitespace so soft breaks are not turned into markdown line breaks', () => {
    expect(normalizeFlattenedWhitespace('Hei,   \nTakk.  ')).toBe('Hei,\nTakk.');
  });

  it('removes the shared indentation that would otherwise render as a markdown code block', () => {
    const body = ['       Hei,', '', '       Takk for hjelpen.'].join('\n');
    expect(normalizeFlattenedWhitespace(body)).toBe('Hei,\n\nTakk for hjelpen.');
  });

  it('keeps relative indentation so a pasted stack trace holds its shape', () => {
    const body = [
      '    Traceback (most recent call last):',
      '      File "app.py", line 12, in <module>',
      '        raise ValueError(msg)',
    ].join('\n');
    expect(normalizeFlattenedWhitespace(body)).toBe(
      [
        'Traceback (most recent call last):',
        '  File "app.py", line 12, in <module>',
        '    raise ValueError(msg)',
      ].join('\n'),
    );
  });

  it('dedents nothing when any line already starts at column zero', () => {
    const body = ['Here is the snippet:', '', '    const x = 1;'].join('\n');
    expect(normalizeFlattenedWhitespace(body)).toBe(body);
  });

  it('leaves ordinary prose untouched', () => {
    const body = 'Hei,\n\nJeg lurer på en ting om prisen.\n\nMvh Ada';
    expect(normalizeFlattenedWhitespace(body)).toBe(body);
  });

  it('handles empty input', () => {
    expect(normalizeFlattenedWhitespace('')).toBe('');
  });
});
