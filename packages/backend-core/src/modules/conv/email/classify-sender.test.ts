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
      }),
    ).toBe(true);
  });
});
