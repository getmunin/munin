import { describe, expect, it } from 'vitest';
import {
  countSignatureHints,
  detectSignatureBlock,
  isTrailingSignatureSplit,
  splitSignatureText,
  stripQuotedReplyText,
  stripSignatureText,
} from './reply-history.ts';

const GMAIL_NB_REPLY = [
  'Så du får ikke gjort noe med dette?',
  '',
  'ons. 26. aug. 2026 kl. 14:05 skrev Globex Support <demo@getmunin.com',
  '>:',
  '',
  '> Hei,',
  '>',
  '> Boligverdien som vises i Globex er et *estimat* hentet fra vår partner',
  '> *Vandelay* – den beregnes automatisk.',
  '>',
  '> Vennlig hilsen',
  '> Globex-teamet',
  '>',
  '> On Wed, 26 Aug 2026 12:04:24 GMT, Ola Nordmann <ola.nordmann@example.no> wrote:',
  '>',
  '> Hei! Jeg fikk helt feil pris på boligen min, dette kan ikke stemme. Fiks!',
  '>',
  '>',
  '',
  '-- ',
  'Med vennlig hilsen',
  'Ola Nordmann',
  '',
  'Mobil: 12 34 56 78',
  'Mail: ola.nordmann@example.no',
  'Web: www.example.no',
].join('\n');

describe('stripQuotedReplyText', () => {
  it('cuts a Gmail Norwegian attribution whose address wrapped onto the next line', () => {
    const r = stripQuotedReplyText(GMAIL_NB_REPLY);
    expect(r).not.toContain('Boligverdien');
    expect(r).not.toContain('skrev Globex Support');
    expect(r.startsWith('Så du får ikke gjort noe med dette?')).toBe(true);
  });

  it('keeps a signature that sits below the quoted block so the signature split still sees it', () => {
    const r = stripQuotedReplyText(GMAIL_NB_REPLY);
    expect(splitSignatureText(r).clean).toBe('Så du får ikke gjort noe med dette?');
    expect(splitSignatureText(r).signature).toContain('Mobil: 12 34 56 78');
  });

  it('cuts an English attribution line', () => {
    const r = stripQuotedReplyText(
      'Thanks!\n\nOn Wed, 26 Aug 2026 at 14:05, Support <s@x.example> wrote:\n\n> Hello there\n> and more\n',
    );
    expect(r).toBe('Thanks!');
  });

  it('cuts a nested attribution that carries its own quote marker', () => {
    const r = stripQuotedReplyText(
      'Takk!\n\n> On Wed, 26 Aug 2026 12:04:24 GMT, Sam <sam@x.example> wrote:\n>\n> Original question\n>\n',
    );
    expect(r).toBe('Takk!');
  });

  it('falls back to the trailing quoted run when no attribution is recognised', () => {
    const r = stripQuotedReplyText('Kort svar.\n\n> gammel melding\n> linje to\n> linje tre\n');
    expect(r).toBe('Kort svar.');
  });

  it('finds a trailing quoted run that sits above a signature', () => {
    const r = stripQuotedReplyText(
      'Kort svar.\n\n> gammel melding\n> linje to\n> linje tre\n\n--\nSam\nsam@x.example',
    );
    expect(r).toBe('Kort svar.\n\n--\nSam\nsam@x.example');
  });

  it('leaves a message with no quoted history untouched', () => {
    const body = 'Hei!\n\nJeg lurer på en ting om prisen.';
    expect(stripQuotedReplyText(body)).toBe(body);
  });

  it('keeps the whole body when the attribution is the first line and nothing precedes it', () => {
    const body = 'On Wed, 26 Aug 2026 at 14:05, Support <s@x.example> wrote:\n\n> Hello\n\nMy answer.';
    expect(stripQuotedReplyText(body)).toBe(body);
  });

  it('does not treat an ordinary Norwegian sentence ending in a colon as an attribution', () => {
    const body = 'Han skrev dette til meg:\n\nog jeg lurer på hva det betyr.';
    expect(stripQuotedReplyText(body)).toBe(body);
  });

  it('cuts a quote that uses a From/Date/Subject/To block instead of > markers', () => {
    const body = [
      'Jeg har sendt det nå, men dette burde kvalitetssikres bedre.',
      '',
      '       From:   <kunde@example.no>',
      '       Date:  September 12th, 2026 13:56',
      '       Subject:  Re: Spørsmål om faktura',
      '       To:   <support@example.com>',
      '',
      'Se vedlegg.',
    ].join('\n');
    expect(stripQuotedReplyText(body)).toBe(
      'Jeg har sendt det nå, men dette burde kvalitetssikres bedre.',
    );
  });

  it('cuts a Norwegian Outlook Fra/Sendt/Til/Emne block', () => {
    const body = [
      'Takk for svaret!',
      '',
      'Fra: Kundeservice <support@example.com>',
      'Sendt: torsdag 10. september 2026 09:14',
      'Til: Ada Berg <ada@example.no>',
      'Emne: SV: Verdivurdering',
      '',
      'Hei, verdien er et estimat.',
    ].join('\n');
    expect(stripQuotedReplyText(body)).toBe('Takk for svaret!');
  });

  it('keeps a declared forward whose sender is the person forwarding it', () => {
    const body = [
      '---------- Forwarded message ---------',
      'From: Ada Berg <ada@example.no>',
      'Date: Mon, 1 Sep 2025 at 10:00',
      'Subject: Faktura',
      'To: <support@acme.test>',
      '',
      'Kan dere hjelpe meg med denne fakturaen?',
    ].join('\n');
    expect(stripQuotedReplyText(body, { forwardedSender: null })).toContain(
      'Kan dere hjelpe meg med denne fakturaen?',
    );
  });

  it('keeps an underscore-ruled forward, note and all, when the subject declares a forward', () => {
    const body = [
      'Hei, se under.',
      '',
      '________________________________',
      'Fra: Ada Berg <ada@example.no>',
      'Sendt: mandag 14. september 2026 16:11',
      'Til: Kundeservice <support@acme.test>',
      'Emne: Faktura',
      '',
      'Kan dere hjelpe meg med denne fakturaen?',
    ].join('\n');
    const kept = stripQuotedReplyText(body, { forwardedSender: null, subject: 'VS: Faktura' });
    expect(kept).toContain('Hei, se under.');
    expect(kept).toContain('Kan dere hjelpe meg med denne fakturaen?');
    expect(splitSignatureText(kept, { subject: 'VS: Faktura' }).clean).toContain(
      'Kan dere hjelpe meg med denne fakturaen?',
    );
  });

  it('still leaves a reply printed above the first header block', () => {
    const body = [
      'Jeg har sendt det nå.',
      '',
      'Hei, har du tatt kontakt med leverandøren?',
      'Med vennlig hilsen, Kundeservice',
      '',
      '       From:   <kunde@example.no>',
      '       Date:  September 12th, 2026 13:56',
      '       Subject:  Re: Spørsmål om faktura',
      '       To:   <support@example.com>',
      '',
      'Se vedlegg.',
    ].join('\n');
    const kept = stripQuotedReplyText(body);
    expect(kept).toContain('Jeg har sendt det nå.');
    expect(kept).toContain('Med vennlig hilsen, Kundeservice');
    expect(kept).not.toContain('Se vedlegg.');
  });

  it('prefers an "On ... wrote:" attribution over a later header block', () => {
    const body = [
      'Mitt svar.',
      '',
      'On Wed, 26 Aug 2026 at 14:05, Support <s@x.example> wrote:',
      '',
      '> From: someone@x.example',
      '> Date: yesterday',
      '> To: me@x.example',
    ].join('\n');
    expect(stripQuotedReplyText(body)).toBe('Mitt svar.');
  });

  it('does not cut on a From: line that no companion headers follow', () => {
    const body = 'Hei,\n\nFrom: the invoice you sent I can see the wrong total.';
    expect(stripQuotedReplyText(body)).toBe(body);
  });

  it('handles empty input', () => {
    expect(stripQuotedReplyText('')).toBe('');
  });
});

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
