import { describe, it, expect } from 'vitest';
import type { ConversationSnapshot, ParentState } from '../operator-bridge/bridge-snapshot.ts';
import {
  escalationAlertHtml,
  invokeMessage,
  mentionActivity,
  messageHtml,
  parentStateLine,
  threadParentActivity,
} from './teams-projection.ts';

const conv: ConversationSnapshot = {
  displayId: 42,
  subject: 'Order <b>missing</b>',
  channelType: 'email',
  channelName: 'Support inbox',
  contactName: 'Ola Nordmann',
  contactEmail: 'ola@example.no',
  contactPhone: null,
  dashboardUrl: 'https://app.example.com/dashboard/conversations/cnv_1',
};

const openState: ParentState = {
  status: 'open',
  needsHumanAttention: false,
  claimedBy: null,
  assignedTo: null,
};

interface Card {
  version: string;
  body: Array<{ type: string; text?: string; facts?: Array<{ title: string; value: string }> }>;
  actions: Array<{ type: string; verb?: string; data?: { conversationId: string }; url?: string }>;
}

function card(state: ParentState): Card {
  const activity = threadParentActivity(conv, state, 'cnv_1');
  expect(activity.attachments).toHaveLength(1);
  expect(activity.attachments![0]!.contentType).toBe('application/vnd.microsoft.card.adaptive');
  return activity.attachments![0]!.content as Card;
}

describe('threadParentActivity', () => {
  it('offers take over and close on an open conversation', () => {
    const c = card(openState);
    expect(c.version).toBe('1.5');
    expect(c.actions.map((a) => a.verb ?? a.type)).toEqual([
      'munin_claim',
      'munin_close',
      'Action.OpenUrl',
    ]);
    expect(c.actions[0]!.data).toEqual({ conversationId: 'cnv_1' });
    expect(c.actions[2]!.url).toBe(conv.dashboardUrl);
  });

  it('offers release while someone holds the conversation', () => {
    const c = card({ ...openState, claimedBy: 'Kari Nordmann' });
    expect(c.actions.map((a) => a.verb)).toEqual(['munin_release', 'munin_close', undefined]);
  });

  it('offers only reopen on a resolved conversation', () => {
    const c = card({ ...openState, status: 'closed' });
    expect(c.actions.map((a) => a.verb)).toEqual(['munin_reopen', undefined]);
  });

  it('shows the contact and source as facts and escapes card markdown', () => {
    const c = card(openState);
    const facts = c.body.find((b) => b.type === 'FactSet')!.facts!;
    expect(facts).toEqual([
      { title: 'From', value: 'Ola Nordmann (ola@example.no)' },
      { title: 'Via', value: 'email (Support inbox)' },
    ]);
    const unsafe = card(openState);
    expect(unsafe.body[0]!.text).toContain('#42');
  });
});

describe('parentStateLine', () => {
  it('summarises holder, assignee and attention', () => {
    expect(
      parentStateLine({
        status: 'open',
        needsHumanAttention: true,
        claimedBy: 'Kari Nordmann',
        assignedTo: 'Ola Nordmann',
      }),
    ).toBe('Status: open · taken over by Kari Nordmann · assigned to Ola Nordmann · 🚨 needs attention');
  });
});

describe('messageHtml', () => {
  it('escapes the body and keeps line breaks', () => {
    const html = messageHtml({
      authorKind: 'end_user',
      authorName: 'Ola Nordmann',
      internal: false,
      body: 'Hi <script>x</script>\nsecond line',
    });
    expect(html).toBe(
      '👤 <b>Ola Nordmann</b> (customer)<br>Hi &lt;script&gt;x&lt;/script&gt;<br>second line',
    );
  });

  it('labels internal notes and lists attachments', () => {
    const html = messageHtml({
      authorKind: 'user',
      authorName: 'Kari Nordmann',
      internal: true,
      body: 'Check the refund',
      attachments: [{ name: 'receipt.pdf', url: 'https://files.example.com/r.pdf' }],
    });
    expect(html).toContain('🔒 <i>Internal note</i> — 🧑‍💻 <b>Kari Nordmann</b> (teammate)');
    expect(html).toContain('📎 <a href="https://files.example.com/r.pdf">receipt.pdf</a>');
  });

  it('escapes quotes so an attachment url cannot break out of its href', () => {
    const html = messageHtml({
      authorKind: 'end_user',
      authorName: 'Ola "O\'Neil" Nordmann',
      internal: false,
      body: 'see attached',
      attachments: [{ name: 'a.pdf', url: 'https://files.example.com/a.pdf?x="onmouseover="alert(1)' }],
    });
    expect(html).toContain('<b>Ola &quot;O&#39;Neil&quot; Nordmann</b>');
    expect(html).toContain('href="https://files.example.com/a.pdf?x=%22onmouseover=%22alert(1)"');
    expect(html).not.toContain('"onmouseover');
  });

  it('lists a non-http attachment by name without linking it', () => {
    const html = messageHtml({
      authorKind: 'end_user',
      authorName: 'Ola Nordmann',
      internal: false,
      body: 'see attached',
      attachments: [{ name: 'evil', url: 'javascript:alert(1)' }],
    });
    expect(html).toContain('📎 evil');
    expect(html).not.toContain('javascript:');
  });

  it('truncates very long bodies', () => {
    const html = messageHtml({
      authorKind: 'agent',
      authorName: null,
      internal: false,
      body: 'x'.repeat(30_000),
    });
    expect(html.length).toBeLessThan(21_000);
    expect(html).toContain('(truncated)');
  });
});

describe('escalationAlertHtml', () => {
  it('names the reason, contact and dashboard link', () => {
    const html = escalationAlertHtml(conv, 'Customer asked for a human');
    expect(html).toContain('conversation #42 via email (Support inbox)');
    expect(html).toContain('<b>Reason:</b> Customer asked for a human');
    expect(html).toContain(`<a href="${conv.dashboardUrl}">Open in Munin</a>`);
  });
});

describe('mentionActivity', () => {
  it('pairs the at-tag with a mention entity for the member', () => {
    const activity = mentionActivity({ memberId: '29:abc', memberName: 'Kari', html: 'hello' });
    expect(activity.text).toBe('<at>Kari</at> hello');
    expect(activity.entities).toEqual([
      { type: 'mention', text: '<at>Kari</at>', mentioned: { id: '29:abc', name: 'Kari' } },
    ]);
  });
});

describe('invokeMessage', () => {
  it('builds a Universal Actions message response', () => {
    expect(invokeMessage('Done')).toEqual({
      status: 200,
      body: { statusCode: 200, type: 'application/vnd.microsoft.activity.message', value: 'Done' },
    });
  });
});
