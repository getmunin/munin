import { describe, expect, it } from 'vitest';
import { dropRecordedTurns, findHeaderBlockQuoteCut, parseQuotedThread } from './quoted-thread.ts';

const HEADER_BLOCK_THREAD = [
  'Jeg har sendt det nå, men dette burde kvalitetssikres bedre. ',
  ' ',
  ' ',
  'Hei, ',
  ' ',
  'Har du tatt kontakt med leverandøren? ',
  ' ',
  'Med vennlig hilsen, ',
  'Kundeservice ',
  ' ',
  '       From:   <kunde@example.no> ',
  '       Date:  September 12th, 2026 13:56 ',
  '       Subject:  Re: Spørsmål om faktura ',
  '       To:   <support@example.com> ',
  ' ',
  'kunde@example.no / kunde2@example.no er kontoene mine. ',
  ' ',
  'Hei, ',
  ' ',
  'Hvilken e-post er kontoen knyttet til? ',
  ' ',
  '       From:   <kunde@example.no> ',
  '       Date:  September 12th, 2026 12:34 ',
  '       Subject:  Spørsmål om faktura ',
  '       To:   <support@example.com> ',
  ' ',
  'Jeg ser på siden min og blir forundret over beregningen. ',
].join('\n');

const NB_OUTLOOK_THREAD = [
  'Takk for svaret!',
  '',
  'Fra: Kundeservice <support@example.com>',
  'Sendt: torsdag 10. september 2026 09:14',
  'Til: Ada Berg <ada@example.no>',
  'Emne: SV: Verdivurdering',
  '',
  'Hei, verdien er et estimat.',
].join('\n');

const GMAIL_FORWARD = [
  'Please handle this one.',
  '',
  '---------- Forwarded message ---------',
  'From: Kari Nordmann <kari@example.test>',
  'Date: Mon, 1 Sep 2025 at 10:00',
  'Subject: Order never arrived',
  'To: <support@acme.test>',
  '',
  'My order never arrived, can you help?',
].join('\n');

const OUTLOOK_REPLY = [
  'nei',
  '',
  '________________________________',
  'Fra: Globex <support@globex.test>',
  'Sendt: mandag 14. september 2026 16:11',
  'Til: Ola Nordmann <ola@kunde.test>',
  'Emne: Har du 1 minutt til overs?',
  '',
  'Hva tror du Norges Bank gjør 24. september?',
].join('\n');

const FORWARDED_REPLY_CHAIN = [
  'Please handle this one.',
  '',
  '---------- Forwarded message ---------',
  'From: Kari Nordmann <kari@example.test>',
  'Date: Mon, 1 Sep 2025 at 10:00',
  'Subject: Re: Order never arrived',
  'To: <support@acme.test>',
  '',
  'It still has not turned up.',
  '',
  'From: Kundeservice <support@acme.test>',
  'Date: Sun, 31 Aug 2025 at 09:00',
  'Subject: Order never arrived',
  'To: <kari@example.test>',
  '',
  'We have shipped it.',
].join('\n');

const SELF_FORWARD = [
  '---------- Forwarded message ---------',
  'From: Ada Berg <ada@example.no>',
  'Date: Mon, 1 Sep 2025 at 10:00',
  'Subject: Faktura',
  'To: <support@acme.test>',
  '',
  'Kan dere hjelpe meg med denne fakturaen?',
].join('\n');

const OUTLOOK_SELF_FORWARD = [
  '________________________________',
  'Fra: Ada Berg <ada@example.no>',
  'Sendt: mandag 14. september 2026 16:11',
  'Til: Kundeservice <support@acme.test>',
  'Emne: Faktura',
  '',
  'Kan dere hjelpe meg med denne fakturaen?',
].join('\n');

describe('parseQuotedThread', () => {
  it('recovers one turn per From/Date/Subject/To block', () => {
    const turns = parseQuotedThread(HEADER_BLOCK_THREAD);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({
      from: '<kunde@example.no>',
      to: '<support@example.com>',
      date: 'September 12th, 2026 13:56',
      subject: 'Re: Spørsmål om faktura',
    });
    expect(turns[1]!.subject).toBe('Spørsmål om faktura');
    expect(turns[1]!.body).toContain('blir forundret over beregningen');
  });

  it('keeps a reply printed above the next header block with the preceding turn', () => {
    const turns = parseQuotedThread(HEADER_BLOCK_THREAD);
    expect(turns[0]!.body).toContain('er kontoene mine');
    expect(turns[0]!.body).toContain('Hvilken e-post er kontoen knyttet til?');
  });

  it('collapses the whitespace-only lines that HTML-to-text flattening leaves behind', () => {
    const turns = parseQuotedThread(HEADER_BLOCK_THREAD);
    expect(turns[0]!.body).not.toMatch(/\n{3}/);
    expect(turns[0]!.body.split('\n').every((l) => l === l.replace(/\s+$/, ''))).toBe(true);
    expect(turns[0]!.body.startsWith('kunde@example.no')).toBe(true);
  });

  it('reads localized Outlook header labels', () => {
    const turns = parseQuotedThread(NB_OUTLOOK_THREAD);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      from: 'Kundeservice <support@example.com>',
      date: 'torsdag 10. september 2026 09:14',
      to: 'Ada Berg <ada@example.no>',
      subject: 'SV: Verdivurdering',
    });
    expect(turns[0]!.body).toBe('Hei, verdien er et estimat.');
  });

  it('keeps the sender-formatted date string verbatim rather than guessing a timestamp', () => {
    const turns = parseQuotedThread(HEADER_BLOCK_THREAD);
    expect(turns[0]!.date).toBe('September 12th, 2026 13:56');
  });

  it('ignores a From: line that no companion headers follow', () => {
    const body = ['Hei,', '', 'From: the receipt you sent me I can see the wrong total.', ''].join(
      '\n',
    );
    expect(parseQuotedThread(body)).toEqual([]);
  });

  it('ignores a single companion header so prose lists are not read as a quote', () => {
    const body = ['Notes from the call:', '', 'From: Ada', 'Subject: pricing', ''].join('\n');
    expect(parseQuotedThread(body)).toEqual([]);
  });


  it('leaves a forwarded message out of the reconstructed history, since it stays in the body', () => {
    expect(parseQuotedThread(GMAIL_FORWARD)).toEqual([]);
  });

  it('reconstructs only what sits below the forwarded message own quoted reply', () => {
    const turns = parseQuotedThread(FORWARDED_REPLY_CHAIN);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ from: 'Kundeservice <support@acme.test>' });
    expect(turns[0]!.body).toBe('We have shipped it.');
  });

  it('reconstructs the mail an Outlook reply quotes, once the message is known not to be a forward', () => {
    const turns = parseQuotedThread(OUTLOOK_REPLY, { forwardedSender: null });
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      from: 'Globex <support@globex.test>',
      to: 'Ola Nordmann <ola@kunde.test>',
      subject: 'Har du 1 minutt til overs?',
    });
    expect(turns[0]!.body).toBe('Hva tror du Norges Bank gjør 24. september?');
  });

  it('keeps a forwarded message out of the history when it is the forward the origin names', () => {
    expect(parseQuotedThread(GMAIL_FORWARD, { forwardedSender: 'kari@example.test' })).toEqual([]);
  });

  it('keeps a declared forward in the body even when the forward names no third-party sender', () => {
    expect(parseQuotedThread(SELF_FORWARD, { forwardedSender: null })).toEqual([]);
  });

  it('keeps an underscore-ruled forward in the body when the subject declares a forward', () => {
    expect(
      parseQuotedThread(OUTLOOK_SELF_FORWARD, { forwardedSender: null, subject: 'VS: Faktura' }),
    ).toEqual([]);
  });

  it('still reconstructs an underscore-ruled block when the subject declares a reply', () => {
    const turns = parseQuotedThread(OUTLOOK_SELF_FORWARD, {
      forwardedSender: null,
      subject: 'SV: Faktura',
    });
    expect(turns).toHaveLength(1);
    expect(turns[0]!.body).toBe('Kan dere hjelpe meg med denne fakturaen?');
  });

  it('treats an underscore rule as a forward marker when the origin is unknown', () => {
    expect(parseQuotedThread(OUTLOOK_REPLY)).toEqual([]);
  });

  it('returns nothing when the body carries no header block', () => {
    expect(parseQuotedThread('Hei, jeg lurer på noe.')).toEqual([]);
    expect(parseQuotedThread('')).toEqual([]);
  });

  it('caps the number of reconstructed turns', () => {
    const block = ['From: a@example.com', 'Date: today', 'Subject: hi', 'To: b@example.com', 'body'];
    const turns = parseQuotedThread(
      ['lead'].concat(...Array.from({ length: 40 }, () => block)).join('\n'),
    );
    expect(turns).toHaveLength(20);
  });

  it('truncates an oversized quoted turn', () => {
    const body = [
      'lead',
      'From: a@example.com',
      'Date: today',
      'To: b@example.com',
      'x'.repeat(9000),
    ].join('\n');
    const turns = parseQuotedThread(body);
    expect(turns[0]!.body).toHaveLength(4001);
    expect(turns[0]!.body.endsWith('…')).toBe(true);
  });
});

describe('findHeaderBlockQuoteCut', () => {
  it('cuts an Outlook reply at the block it quotes once the message is known not to be a forward', () => {
    const lines = OUTLOOK_REPLY.split('\n');
    expect(findHeaderBlockQuoteCut(lines, { forwardedSender: null })).toBe(3);
  });

  it('still protects a forwarded message body when the origin names its sender', () => {
    expect(findHeaderBlockQuoteCut(GMAIL_FORWARD.split('\n'), {
      forwardedSender: 'kari@example.test',
    })).toBeNull();
  });

  it('declines to cut a declared forward whose sender is the person forwarding it', () => {
    expect(findHeaderBlockQuoteCut(SELF_FORWARD.split('\n'), { forwardedSender: null })).toBeNull();
  });

  it('declines to cut an underscore-ruled forward when the subject declares a forward', () => {
    expect(
      findHeaderBlockQuoteCut(OUTLOOK_SELF_FORWARD.split('\n'), {
        forwardedSender: null,
        subject: 'VS: Faktura',
      }),
    ).toBeNull();
  });

  it('cuts at the first header block', () => {
    const lines = HEADER_BLOCK_THREAD.split('\n');
    const cut = findHeaderBlockQuoteCut(lines);
    expect(cut).not.toBeNull();
    expect(lines[cut!]!.trim()).toBe('From:   <kunde@example.no>');
  });

  it('declines to cut when the header block opens the body, so a bare forward keeps its text', () => {
    const lines = NB_OUTLOOK_THREAD.split('\n').slice(2);
    expect(findHeaderBlockQuoteCut(lines)).toBeNull();
  });


  it('declines to cut into a forwarded message, whose content is the message itself', () => {
    const cut = findHeaderBlockQuoteCut(GMAIL_FORWARD.split('\n'));
    expect(cut).toBeNull();
  });

  it('cuts at the reply the forwarded message itself quotes', () => {
    const lines = FORWARDED_REPLY_CHAIN.split('\n');
    const cut = findHeaderBlockQuoteCut(lines);
    expect(cut).not.toBeNull();
    expect(lines[cut!]).toBe('From: Kundeservice <support@acme.test>');
    expect(lines.slice(0, cut!).join('\n')).toContain('It still has not turned up.');
  });

  it('returns null for a body with no header block', () => {
    expect(findHeaderBlockQuoteCut(['Hei,', 'Takk for hjelpen.'])).toBeNull();
  });
});

describe('dropRecordedTurns', () => {
  const turn = (body: string) => ({ from: 'Kundeservice', to: null, date: null, subject: null, body });

  it('drops a turn the conversation already holds as a message', () => {
    const body = 'Hei Ada,\n\nFakturaen ble sendt på nytt i går kveld.';
    expect(dropRecordedTurns([turn(body)], [body])).toEqual([]);
  });

  it('drops a turn the sender re-wrapped, since the words are the same', () => {
    const recorded = 'Hei Ada,\n\nFakturaen ble sendt på nytt i går kveld. Si fra om den ikke dukker opp.';
    const quoted = 'Hei Ada,\n\nFakturaen ble sendt på nytt i går\nkveld. Si fra om den ikke   dukker opp.';
    expect(dropRecordedTurns([turn(quoted)], [recorded])).toEqual([]);
  });

  it('drops a turn the sender client truncated', () => {
    const recorded = 'Hei Ada, fakturaen ble sendt på nytt i går kveld, og du finner den i portalen.';
    expect(dropRecordedTurns([turn(recorded.slice(0, 55))], [recorded])).toEqual([]);
  });

  it('keeps a turn Munin never recorded, which is why the history exists', () => {
    const kept = turn('Vi har registrert saken og kommer tilbake innen 48 timer.');
    expect(dropRecordedTurns([kept], ['Helt andre ord i en annen melding i samtalen.'])).toEqual([
      kept,
    ]);
  });

  it('does not match two short bodies on a shared opening', () => {
    const kept = turn('Takk!');
    expect(dropRecordedTurns([kept], ['Takk for at du tok kontakt.'])).toEqual([kept]);
  });

  it('keeps every turn when the conversation holds no messages yet', () => {
    const turns = [turn('En melding'), turn('En annen melding')];
    expect(dropRecordedTurns(turns, [])).toEqual(turns);
  });
});

const APPLE_MAIL_NESTED = [
  'Hei! Dette er en test.',
  '',
  'Kjell Rune Monsø',
  '',
  '> On 15 Sep 2026, at 09:37, Apps Support <hello@apps.no> wrote:',
  '> ',
  '> This is an automated test from Munin.',
  '> ',
  '>> On 14 Sep 2026, at 11:20, Kjell Rune Monsø <kjell@apps.no> wrote:',
  '>> ',
  '>> Can you confirm the address works?',
].join('\n');

describe('parseQuotedThread: attribution-line quoting', () => {
  it('reconstructs an Apple Mail reply, which quotes without a header block', () => {
    const turns = parseQuotedThread(APPLE_MAIL_NESTED);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({
      from: 'Apps Support <hello@apps.no>',
      body: 'This is an automated test from Munin.',
    });
    expect(turns[1]).toMatchObject({
      from: 'Kjell Rune Monsø <kjell@apps.no>',
      body: 'Can you confirm the address works?',
    });
  });

  it('strips one level of quote marker per nesting depth', () => {
    const turns = parseQuotedThread(APPLE_MAIL_NESTED);
    expect(turns.some((t) => t.body.includes('>'))).toBe(false);
  });

  it('leaves to, date and subject null rather than inventing them', () => {
    const turn = parseQuotedThread(APPLE_MAIL_NESTED)[0]!;
    expect(turn.to).toBeNull();
    expect(turn.date).toBeNull();
    expect(turn.subject).toBeNull();
  });

  it('reads a Gmail-style attribution without angle brackets', () => {
    const turns = parseQuotedThread(
      ['Thanks!', '', 'On Mon, Sep 15, 2026 at 9:37 AM hello@apps.no wrote:', '> the original'].join('\n'),
    );
    expect(turns).toHaveLength(1);
    expect(turns[0]!.from).toBe('hello@apps.no');
  });

  it('reads a Norwegian attribution line', () => {
    const turns = parseQuotedThread(
      ['Takk!', '', 'Den 15. sep. 2026 kl. 09:37 skrev Apps Support <hello@apps.no>:', '> originalen'].join('\n'),
    );
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ from: 'Apps Support <hello@apps.no>', body: 'originalen' });
  });

  it('stays silent when the whole message is quoted, which is a forward not a reply', () => {
    expect(
      parseQuotedThread(['> On 15 Sep 2026, at 09:37, A <a@b.test> wrote:', '> hi'].join('\n')),
    ).toEqual([]);
  });

  it('prefers the header-block reading when a message carries both', () => {
    const turns = parseQuotedThread(HEADER_BLOCK_THREAD);
    expect(turns.length).toBeGreaterThan(0);
    expect(turns[0]!.subject).toBe('Re: Spørsmål om faktura');
  });
});
