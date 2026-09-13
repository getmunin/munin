import { describe, expect, it } from 'vitest';
import { findHeaderBlockQuoteCut, parseQuotedThread } from './quoted-thread.ts';

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

  it('returns null for a body with no header block', () => {
    expect(findHeaderBlockQuoteCut(['Hei,', 'Takk for hjelpen.'])).toBeNull();
  });
});
