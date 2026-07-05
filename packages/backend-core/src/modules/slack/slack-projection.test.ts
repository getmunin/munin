import { describe, it, expect } from 'vitest';
import {
  authorLabel,
  escalationAlertText,
  escapeSlackText,
  messageText,
  parentStateLine,
  statusChangedText,
  threadParentBlocks,
  threadParentText,
  type ConversationSnapshot,
} from './slack-projection.ts';

const conv: ConversationSnapshot = {
  displayId: 42,
  subject: 'Refund for order <#1001>',
  channelType: 'email',
  channelName: 'Support inbox',
  contactName: 'Ada Lovelace',
  contactEmail: 'ada@example.com',
  contactPhone: null,
  dashboardUrl: 'https://app.example.com/dashboard',
};

describe('escapeSlackText', () => {
  it('escapes mrkdwn control characters', () => {
    expect(escapeSlackText('a <b> & c')).toBe('a &lt;b&gt; &amp; c');
  });
});

describe('threadParentText', () => {
  it('includes display id, source, contact, subject, and link', () => {
    const text = threadParentText(conv);
    expect(text).toContain('#42');
    expect(text).toContain('email (Support inbox)');
    expect(text).toContain('Ada Lovelace');
    expect(text).toContain('ada@example.com');
    expect(text).toContain('Refund for order &lt;#1001&gt;');
    expect(text).toContain('<https://app.example.com/dashboard|Open in Munin>');
  });

  it('omits contact and subject lines when absent', () => {
    const text = threadParentText({
      ...conv,
      subject: null,
      contactName: null,
      contactEmail: null,
    });
    expect(text).not.toContain('*From:*');
    expect(text).not.toContain('*Subject:*');
  });
});

describe('messageText', () => {
  it('labels customers and quotes the body', () => {
    const text = messageText({
      authorKind: 'end_user',
      authorName: 'Ada',
      internal: false,
      body: 'line one\nline two',
    });
    expect(text).toContain('*Ada* (customer)');
    expect(text).toContain('> line one\n> line two');
  });

  it('marks internal notes', () => {
    const text = messageText({
      authorKind: 'agent',
      authorName: null,
      internal: true,
      body: 'draft reply',
    });
    expect(text).toContain(':lock:');
    expect(text).toContain('*AI agent*');
  });

  it('truncates long bodies', () => {
    const text = messageText({
      authorKind: 'user',
      authorName: 'Kim',
      internal: false,
      body: 'x'.repeat(5000),
    });
    expect(text).toContain('_(truncated)_');
    expect(text.length).toBeLessThan(3500);
  });
});

describe('authorLabel', () => {
  it('covers every author kind', () => {
    expect(authorLabel('end_user', null)).toContain('Customer');
    expect(authorLabel('agent', null)).toContain('AI agent');
    expect(authorLabel('user', 'Kim')).toContain('Kim');
    expect(authorLabel('system', null)).toContain('System');
  });
});

describe('statusChangedText', () => {
  it('renders known and unknown statuses', () => {
    expect(statusChangedText('closed')).toContain('*closed*');
    expect(statusChangedText('weird')).toContain('*weird*');
  });
});

describe('parentStateLine + threadParentBlocks', () => {
  const openState = {
    status: 'open',
    needsHumanAttention: false,
    claimedBy: null,
    assignedTo: null,
  };

  function actionsOf(blocks: ReturnType<typeof threadParentBlocks>) {
    const block = blocks.find((b) => b.type === 'actions');
    return (block?.elements as { action_id: string; value: string }[] | undefined) ?? [];
  }

  function sectionTextOf(blocks: ReturnType<typeof threadParentBlocks>): string {
    const block = blocks.find((b) => b.type === 'section');
    return (block?.text as { text?: string } | undefined)?.text ?? '';
  }

  it('renders claim, assignment, and attention segments', () => {
    const line = parentStateLine({
      status: 'open',
      needsHumanAttention: true,
      claimedBy: 'Kim <ops>',
      assignedTo: 'Ada',
    });
    expect(line).toContain('*Status:* open');
    expect(line).toContain('claimed by *Kim &lt;ops&gt;*');
    expect(line).toContain('assigned to *Ada*');
    expect(line).toContain('needs attention');
  });

  it('shows Claim/Close buttons while open and Reopen once resolved', () => {
    const openActions = actionsOf(threadParentBlocks(conv, openState, 'ccv_1'));
    expect(openActions.map((e) => e.action_id)).toEqual(['munin_claim', 'munin_close']);
    expect(openActions[0]!.value).toBe('ccv_1');

    const closedActions = actionsOf(
      threadParentBlocks(conv, { ...openState, status: 'closed' }, 'ccv_1'),
    );
    expect(closedActions.map((e) => e.action_id)).toEqual(['munin_reopen']);
  });

  it('embeds the parent text and state line in the section block', () => {
    const text = sectionTextOf(threadParentBlocks(conv, openState, 'ccv_1'));
    expect(text).toContain('#42');
    expect(text).toContain('*Status:* open');
  });
});

describe('escalationAlertText', () => {
  it('leads with the mention and includes the reason', () => {
    const text = escalationAlertText(conv, 'Customer is angry', '<!here>');
    expect(text.startsWith(':rotating_light: <!here> ')).toBe(true);
    expect(text).toContain('Customer is angry');
    expect(text).toContain('#42');
  });

  it('works without mention or reason', () => {
    const text = escalationAlertText(conv, null, null);
    expect(text).not.toContain('null');
    expect(text).toContain('*Human attention needed*');
  });
});
