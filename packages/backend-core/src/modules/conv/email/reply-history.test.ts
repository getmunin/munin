import { describe, expect, it } from 'vitest';
import {
  countSignatureHints,
  detectSignatureBlock,
  isTrailingSignatureSplit,
  splitSignatureText,
  stripSignatureText,
} from './reply-history.ts';

describe('splitSignatureText', () => {
  it('returns null signature when no opener present', () => {
    const r = splitSignatureText('Hi there,\n\nQuick question about pricing.');
    expect(r.signature).toBeNull();
    expect(r.clean).toBe('Hi there,\n\nQuick question about pricing.');
  });

  it('preserves iPhone tagline as signature', () => {
    const r = splitSignatureText('Sure, sounds good!\n\nSent from my iPhone');
    expect(r.clean).toBe('Sure, sounds good!');
    expect(r.signature).toBe('Sent from my iPhone');
  });

  it('preserves a -- delimited block as signature', () => {
    const body = 'Thanks for the help.\n\n--\nJane Doe\nHead of Ops\nAcme';
    const r = splitSignatureText(body);
    expect(r.clean).toBe('Thanks for the help.');
    expect(r.signature).toBe('--\nJane Doe\nHead of Ops\nAcme');
  });

  it('preserves underscore horizontal rule as signature', () => {
    const body = 'Confirmed.\n\n________________________\nJane Doe';
    const r = splitSignatureText(body);
    expect(r.signature).toContain('Jane Doe');
    expect(r.clean).toBe('Confirmed.');
  });

  it('returns body unchanged when stripping would leave nothing', () => {
    const r = splitSignatureText('Sent from my iPhone');
    expect(r.clean).toBe('Sent from my iPhone');
    expect(r.signature).toBeNull();
  });

  it('stripSignatureText remains a thin wrapper returning clean only', () => {
    const body = 'Hello\n\nSent from my iPhone';
    expect(stripSignatureText(body)).toBe('Hello');
  });

  it('handles empty input', () => {
    expect(splitSignatureText('')).toEqual({ clean: '', signature: null });
  });
});

describe('detectSignatureBlock', () => {
  it('flags a typical name + title + company + contact block', () => {
    const body = [
      'Hello, what can you do for me?',
      '',
      'Sam Rivera',
      'CTO',
      '',
      'Northwind Labs',
      '12 Harbor St',
      'Springfield',
      '',
      'Email: sam@northwind.example',
      'Phone: +1 555 0142',
      'Web: northwind.example',
    ].join('\n');
    const sig = detectSignatureBlock(body);
    expect(sig).not.toBeNull();
    expect(sig).toContain('Email: sam@northwind.example');
    expect(sig).toContain('Phone: +1 555 0142');
  });

  it('returns null when the trailing block has no contact-info hints', () => {
    const body = ['I had a thought about pricing.', '', 'Let me know what you think.'].join('\n');
    expect(detectSignatureBlock(body)).toBeNull();
  });

  it('returns null when the message has no blank-line separator (whole body)', () => {
    const body = 'Quick question — what is your pricing? You can reach me at jane@acme.com.';
    expect(detectSignatureBlock(body)).toBeNull();
  });

  it('returns null when the kept portion is empty (whole message looks like a signature)', () => {
    const body = ['', 'Jane Doe', 'Head of Ops', 'jane@acme.com'].join('\n');
    expect(detectSignatureBlock(body)).toBeNull();
  });

  it('extracts text from a gmail_signature div in HTML when present', () => {
    const html =
      '<div>Hi there.</div>' +
      '<div class="gmail_signature" data-smartmail="gmail_signature">' +
      '<div>Jane Doe</div><div>Head of Ops · Acme</div><div>jane@acme.com</div>' +
      '</div>';
    const sig = detectSignatureBlock('Hi there.', html);
    expect(sig).not.toBeNull();
    expect(sig).toContain('Jane Doe');
    expect(sig).toContain('jane@acme.com');
  });

  it('prefers the HTML signature over the soft text detector', () => {
    const html =
      '<div class="gmail_signature"><div>Jane Doe</div><div>jane@acme.com</div></div>';
    const text = ['Hi.', '', 'Bob Builder', 'bob@otherco.com'].join('\n');
    const sig = detectSignatureBlock(text, html);
    expect(sig).toContain('Jane Doe');
    expect(sig).not.toContain('Bob Builder');
  });

  it('caps the detected block at a sensible length', () => {
    const trailing = Array.from({ length: 40 }, (_, i) => `line${i} jane@acme.com`).join('\n');
    const body = `Hi.\n\n${trailing}`;
    expect(detectSignatureBlock(body)).toBeNull();
  });

  it('returns null for empty inputs', () => {
    expect(detectSignatureBlock('')).toBeNull();
    expect(detectSignatureBlock('', null)).toBeNull();
  });
});

describe('countSignatureHints', () => {
  it('counts distinct contact-info hint types across lines', () => {
    const sig = [
      'Sam Rivera CTO',
      'Northwind Labs, 12 Harbor St, Springfield',
      'Email: sam@northwind.example Phone: +1 555 0142 Web: northwind.example',
    ].join('\n');
    expect(countSignatureHints(sig)).toBeGreaterThanOrEqual(2);
  });

  it('returns 0 for a block with no contact info', () => {
    expect(countSignatureHints('Looks cool!')).toBe(0);
    expect(countSignatureHints('')).toBe(0);
  });
});

describe('isTrailingSignatureSplit', () => {
  const original = [
    'Looks cool!',
    '',
    'Sam Rivera CTO',
    '',
    'Email: sam@northwind.example Phone: +1 555 0142',
  ].join('\n');

  it('confirms body is a prefix and signature the trailing remainder', () => {
    const signature = 'Sam Rivera CTO\n\nEmail: sam@northwind.example Phone: +1 555 0142';
    expect(isTrailingSignatureSplit(original, 'Looks cool!', signature)).toBe(true);
  });

  it('tolerates whitespace differences', () => {
    const signature = 'Sam Rivera CTO   Email: sam@northwind.example Phone:  +1 555 0142';
    expect(isTrailingSignatureSplit(original, 'Looks   cool!', signature)).toBe(true);
  });

  it('rejects when the body is not a prefix of the original', () => {
    expect(
      isTrailingSignatureSplit(original, 'Something else', 'Email: sam@northwind.example Phone: x'),
    ).toBe(false);
  });

  it('rejects when the signature is not the trailing portion', () => {
    expect(isTrailingSignatureSplit(original, 'Looks cool!', 'unrelated text')).toBe(false);
  });

  it('rejects empty inputs', () => {
    expect(isTrailingSignatureSplit('', 'a', 'b')).toBe(false);
    expect(isTrailingSignatureSplit(original, 'Looks cool!', '')).toBe(false);
  });
});
