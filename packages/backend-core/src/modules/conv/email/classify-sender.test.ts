import { describe, expect, it } from 'vitest';
import { classifySender, hasAnyClassification, suppressionReason } from './classify-sender.ts';

type Headers = { key: string; line: string }[];

const h = (lines: Record<string, string>): Headers =>
  Object.entries(lines).map(([k, v]) => ({ key: k.toLowerCase(), line: `${k}: ${v}` }));

describe('classifySender', () => {
  it('flags plain human From with no list headers as nothing', () => {
    const c = classifySender(h({ From: 'jane@acme.com' }), 'jane@acme.com');
    expect(c).toEqual({
      isMailingList: false,
      isAutoReply: false,
      isRoleAccount: false,
      isBounce: false,
      autoReplySignal: null,
    });
    expect(hasAnyClassification(c)).toBe(false);
  });

  it('detects mailing list via List-Id', () => {
    const c = classifySender(
      h({ 'List-Id': 'Acme Announcements <announce.acme.com>' }),
      'jane@acme.com',
    );
    expect(c.isMailingList).toBe(true);
  });

  it('detects mailing list via List-Unsubscribe', () => {
    const c = classifySender(
      h({ 'List-Unsubscribe': '<mailto:unsub@acme.com>' }),
      'jane@acme.com',
    );
    expect(c.isMailingList).toBe(true);
  });

  it('detects mailing list via Precedence: bulk', () => {
    const c = classifySender(h({ Precedence: 'bulk' }), 'jane@acme.com');
    expect(c.isMailingList).toBe(true);
  });

  it('detects auto-reply via Auto-Submitted', () => {
    const c = classifySender(h({ 'Auto-Submitted': 'auto-replied' }), 'jane@acme.com');
    expect(c.isAutoReply).toBe(true);
  });

  it('does not flag Auto-Submitted: no', () => {
    const c = classifySender(h({ 'Auto-Submitted': 'no' }), 'jane@acme.com');
    expect(c.isAutoReply).toBe(false);
  });

  it('reads Auto-Submitted past its parameters', () => {
    const c = classifySender(
      h({ 'Auto-Submitted': 'auto-replied; owner-email="oof@acme.com"' }),
      'jane@acme.com',
    );
    expect(c.autoReplySignal).toBe('auto_submitted');
  });

  it('keeps a human mail answerable when a forwarding hop stamped it Auto-Submitted: auto-forwarded', () => {
    const c = classifySender(h({ 'Auto-Submitted': 'auto-forwarded' }), 'kari@kunde.no');
    expect(suppressionReason(c)).toBeNull();
  });

  it('keeps a human mail answerable when Exchange stamped X-Auto-Response-Suppress on the forwarded copy', () => {
    const c = classifySender(
      h({
        From: 'kari@kunde.no',
        Subject: 'SV: Feil i mine opplysninger.',
        'X-Auto-Response-Suppress': 'All',
        'Auto-Submitted': 'auto-forwarded',
      }),
      'kari@kunde.no',
    );
    expect(c.isAutoReply).toBe(false);
    expect(suppressionReason(c)).toBeNull();
  });

  it('still suppresses a real out-of-office that also carries X-Auto-Response-Suppress', () => {
    const c = classifySender(
      h({
        Subject: 'Automatic reply: Vi har oppdatert dine gjeldsdata',
        'X-Auto-Response-Suppress': 'All',
      }),
      'preben@kunde.no',
    );
    expect(suppressionReason(c)).toBe('auto_reply');
    expect(c.autoReplySignal).toBe('subject');
  });

  it('names the rule that flagged the message', () => {
    expect(classifySender(h({ Precedence: 'junk' }), 'jane@acme.com').autoReplySignal).toBe(
      'precedence_junk',
    );
    expect(classifySender(h({ 'X-Autoreply': 'yes' }), 'jane@acme.com').autoReplySignal).toBe(
      'x_autoreply',
    );
    expect(classifySender(h({ 'X-Autorespond': 'yes' }), 'jane@acme.com').autoReplySignal).toBe(
      'x_autorespond',
    );
    expect(
      classifySender(h({ Precedence: 'bulk' }), 'noreply@vendor.example').autoReplySignal,
    ).toBe('precedence_bulk');
    expect(classifySender(h({ From: 'jane@acme.com' }), 'jane@acme.com').autoReplySignal).toBeNull();
  });

  it('detects bounce via empty Return-Path', () => {
    const c = classifySender(h({ 'Return-Path': '<>' }), 'jane@acme.com');
    expect(c.isBounce).toBe(true);
  });

  it('detects bounce via From: mailer-daemon', () => {
    const c = classifySender(h({}), 'mailer-daemon@acme.com');
    expect(c.isBounce).toBe(true);
  });

  it('detects role account: support@', () => {
    const c = classifySender(h({}), 'support@acme.com');
    expect(c.isRoleAccount).toBe(true);
  });

  it('detects role account: no-reply with plus-tag', () => {
    const c = classifySender(h({}), 'no-reply+thread-42@acme.com');
    expect(c.isRoleAccount).toBe(true);
  });

  it('detects role account: noreply (no hyphen)', () => {
    const c = classifySender(h({}), 'noreply@acme.com');
    expect(c.isRoleAccount).toBe(true);
  });

  it('does not flag j.doe@acme.com as role', () => {
    const c = classifySender(h({}), 'j.doe@acme.com');
    expect(c.isRoleAccount).toBe(false);
  });

  it('combines flags: mailing list + role account', () => {
    const c = classifySender(
      h({ 'List-Id': '<news.acme.com>' }),
      'newsletter@acme.com',
    );
    expect(c.isMailingList).toBe(true);
    expect(c.isRoleAccount).toBe(true);
  });

  it('suppresses an out-of-office auto-reply', () => {
    const c = classifySender(
      h({ From: 'terje@post.no', 'Auto-Submitted': 'auto-replied' }),
      'terje@post.no',
    );
    expect(suppressionReason(c)).toBe('auto_reply');
  });

  it('suppresses a bounce, and reports bounce over auto-reply', () => {
    const c = classifySender(
      h({ 'Return-Path': '<>', 'Auto-Submitted': 'auto-replied' }),
      'mailer-daemon@post.no',
    );
    expect(suppressionReason(c)).toBe('bounce');
  });

  it('reads a Microsoft 365 out-of-office as an auto-reply, not as a bounce', () => {
    const c = classifySender(
      h({
        From: 'Ole-Martin <ole-martin@nortekstil.no>',
        'Return-Path': '<postmaster@osppr02cu001.outbound.protection.outlook.com>',
        Subject: 'Automatic reply: Vi har oppdatert dine gjeldsdata',
        'Auto-Submitted': 'auto-replied',
      }),
      'ole-martin@nortekstil.no',
    );
    expect(c.isBounce).toBe(false);
    expect(suppressionReason(c)).toBe('auto_reply');
  });

  it('reads the RFC 3834 null envelope sender on a vacation reply as an auto-reply', () => {
    const c = classifySender(
      h({ 'Return-Path': '<>', Subject: 'Automatisk svar: Nyhetsbrev februar' }),
      'kari@post.no',
    );
    expect(c.isBounce).toBe(false);
    expect(suppressionReason(c)).toBe('auto_reply');
  });

  it('still calls a postmaster envelope sender a bounce when nothing says auto-reply', () => {
    const c = classifySender(
      h({ 'Return-Path': '<postmaster@mail.acme.com>' }),
      'jane@acme.com',
    );
    expect(suppressionReason(c)).toBe('bounce');
  });

  it('reports bounce over auto-reply when the mail carries a delivery-status report', () => {
    const c = classifySender(
      h({
        'Return-Path': '<postmaster@mail.acme.com>',
        Subject: 'Automatic reply: Question about pricing',
        'Content-Type': 'multipart/report; report-type=delivery-status; boundary=x',
      }),
      'jane@acme.com',
    );
    expect(suppressionReason(c)).toBe('bounce');
  });

  it('suppresses an ESP bounce mailbox that is not mailer-daemon or postmaster', () => {
    for (const from of [
      'bounces@amazonses.com',
      'bounce@sendgrid.net',
      'bounce+tag-abc@mg.acme.com',
      'mailerdaemon@old.example.com',
    ]) {
      expect(suppressionReason(classifySender(h({ From: from }), from))).toBe('bounce');
    }
  });

  it('suppresses an RFC 3464 delivery-status report whatever address it comes from', () => {
    const c = classifySender(
      h({
        From: 'noreply@relay.acme.com',
        'Content-Type': 'multipart/report; report-type=delivery-status; boundary="x"',
      }),
      'noreply@relay.acme.com',
    );
    expect(suppressionReason(c)).toBe('bounce');
  });

  it('suppresses a delivery-status report whose report-type is quoted', () => {
    const c = classifySender(
      h({ 'Content-Type': 'multipart/report; report-type="delivery-status"' }),
      'noreply@relay.acme.com',
    );
    expect(suppressionReason(c)).toBe('bounce');
  });

  it('suppresses a bounce carrying X-Failed-Recipients', () => {
    const c = classifySender(
      h({ From: 'noreply@relay.acme.com', 'X-Failed-Recipients': 'edma@rosenberg.as' }),
      'noreply@relay.acme.com',
    );
    expect(suppressionReason(c)).toBe('bounce');
  });

  it('does not treat an ordinary multipart report as a bounce', () => {
    const c = classifySender(
      h({ 'Content-Type': 'multipart/report; report-type=disposition-notification' }),
      'jane@acme.com',
    );
    expect(suppressionReason(c)).toBeNull();
  });

  it('suppresses an out-of-office reply that carries no auto-reply header, only the subject prefix', () => {
    for (const subject of [
      'Automatisk svar: Nyhetsbrev februar',
      'Autosvar: Nyhetsbrev',
      'Ute av kontoret: Nyhetsbrev',
      'Out of Office: February newsletter',
      'Automatic reply: February newsletter',
      'Fraværende: Nyhetsbrev',
      'Abwesenheitsnotiz: Newsletter',
      'Re: Automatisk svar: Nyhetsbrev',
    ]) {
      const c = classifySender(h({ Subject: subject }), 'kari@kunde.no');
      expect(suppressionReason(c), subject).toBe('auto_reply');
    }
  });

  it('does not read an ordinary subject that merely mentions the office as an auto-reply', () => {
    for (const subject of [
      'Spørsmål om automatisk svar i skjemaet',
      'Out of office hours support?',
      'Autosvaret deres virker ikke',
    ]) {
      const c = classifySender(h({ Subject: subject }), 'kari@kunde.no');
      expect(suppressionReason(c), subject).toBeNull();
    }
  });

  it('keeps a human reply answerable when the newsletter subject itself opens with those words', () => {
    for (const subject of [
      'Re: Ute av kontoret? Slik setter du opp autosvar',
      'Sv: Out of office made easy — februar',
      'Re: Nyhetsbrev februar',
    ]) {
      const c = classifySender(h({ Subject: subject }), 'siri@kunde.no');
      expect(suppressionReason(c), subject).toBeNull();
    }
  });

  it('suppresses Precedence: bulk with no list headers, which is machine mail nobody should answer', () => {
    const c = classifySender(h({ Precedence: 'bulk' }), 'noreply@vendor.example');
    expect(suppressionReason(c)).toBe('auto_reply');
  });

  it('still leaves a real mailing-list post answerable even though it is Precedence: bulk', () => {
    const c = classifySender(
      h({ Precedence: 'bulk', 'List-Id': 'announce.acme.com' }),
      'list@acme.com',
    );
    expect(suppressionReason(c)).toBeNull();
  });

  it('does not suppress a mailing-list post or a role account', () => {
    const list = classifySender(h({ 'List-Id': 'announce.acme.com' }), 'jane@acme.com');
    expect(suppressionReason(list)).toBeNull();
    const role = classifySender(h({ From: 'support@acme.com' }), 'support@acme.com');
    expect(suppressionReason(role)).toBeNull();
  });

  it('does not suppress a human reply', () => {
    const c = classifySender(h({ From: 'jane@acme.com' }), 'jane@acme.com');
    expect(suppressionReason(c)).toBeNull();
  });

  it('hasAnyClassification true when any flag set', () => {
    expect(
      hasAnyClassification({
        isMailingList: false,
        isAutoReply: true,
        isRoleAccount: false,
        isBounce: false,
        autoReplySignal: 'subject',
      }),
    ).toBe(true);
  });
});
