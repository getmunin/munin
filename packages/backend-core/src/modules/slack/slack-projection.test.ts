import { describe, it, expect } from 'vitest';
import {
  APPROVAL_DISMISS_ACTION_ID,
  approvalBlocks,
  approvalResolvedLine,
  authorLabel,
  avatarKey,
  cmsEntryPublishedText,
  encodeApprovalValue,
  escalationAlertText,
  escapeSlackText,
  kbCandidateApprovalText,
  mergeProposalApprovalText,
  messageBodyText,
  messageText,
  outreachCampaignParentMovedText,
  outreachCampaignParentText,
  outreachProposalApprovalText,
  parentStateLine,
  parseApprovalValue,
  speakerIdentity,
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
  it('headlines the subject when set', () => {
    const text = threadParentText(conv);
    expect(text).toContain('*Refund for order &lt;#1001&gt;* — #42 via email (Support inbox)');
    expect(text).not.toContain('New conversation');
    expect(text).toContain('Ada Lovelace');
    expect(text).toContain('ada@example.com');
    expect(text).toContain('<https://app.example.com/dashboard|Open in Munin>');
  });

  it('falls back to a generic headline and omits contact when absent', () => {
    const text = threadParentText({
      ...conv,
      subject: null,
      contactName: null,
      contactEmail: null,
    });
    expect(text).toContain('*New conversation #42* — via email (Support inbox)');
    expect(text).not.toContain('*From:*');
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

describe('avatarKey', () => {
  it('uses the first letter, uppercased', () => {
    expect(avatarKey('Ada')).toBe('A');
    expect(avatarKey('ada')).toBe('A');
  });

  it('falls back to default for anonymous names or ones with no letters at all', () => {
    expect(avatarKey(null)).toBe('default');
    expect(avatarKey('')).toBe('default');
    expect(avatarKey('+4741425762')).toBe('default');
    expect(avatarKey('+47 414 25 762')).toBe('default');
  });
});

describe('speakerIdentity', () => {
  it('gives system messages the same plain Munin identity as agent messages, no icon override', () => {
    expect(speakerIdentity('system', null)).toEqual({ username: 'Munin' });
    expect(speakerIdentity('agent', null)).toEqual({ username: 'Munin' });
  });

  it('routes a digit-led end_user name to the default avatar', () => {
    expect(speakerIdentity('end_user', '+4741425762')).toEqual({
      username: '+4741425762',
      avatarKey: 'default',
    });
  });

  it('gives teammates the same letter-avatar scheme as customers, on a dark variant', () => {
    expect(speakerIdentity('user', 'Kim')).toEqual({ username: 'Kim', avatarKey: 'K-dark' });
    expect(speakerIdentity('user', null)).toEqual({
      username: 'Teammate',
      avatarKey: 'default-dark',
    });
  });
});

describe('messageBodyText', () => {
  it('wraps system messages with a gear and bold, leaves other kinds plain', () => {
    expect(messageBodyText({ authorKind: 'system', authorName: null, internal: false, body: 'Voice call started · Thea' }))
      .toBe(':gear: *Voice call started · Thea*');
    expect(messageBodyText({ authorKind: 'agent', authorName: 'Munin', internal: false, body: 'Hi there' }))
      .toBe('Hi there');
  });

  it('renders an agent reply written in markdown as Slack mrkdwn', () => {
    const text = messageBodyText({
      authorKind: 'agent',
      authorName: 'Thea',
      internal: false,
      body: '**Slik fungerer det:**\n- **Svare** på spørsmål\n\nSe [Threll.ai](https://threll.ai).',
    });
    expect(text).toBe(
      '*Slik fungerer det:*\n• *Svare* på spørsmål\n\nSe <https://threll.ai|Threll.ai>.',
    );
  });

  it('closes an unterminated code fence and keeps a link whole when truncating', () => {
    const fenced = messageBodyText({
      authorKind: 'agent',
      authorName: 'Thea',
      internal: false,
      body: `\`\`\`\n${'x'.repeat(5000)}\n\`\`\``,
    });
    expect(fenced.split('```')).toHaveLength(3);
    expect(fenced).toContain('_(truncated)_');

    const linked = messageBodyText({
      authorKind: 'agent',
      authorName: 'Thea',
      internal: false,
      body: `${'x'.repeat(2890)}[docs](https://threll.ai/docs)`,
    });
    expect(linked).not.toContain('<https://threll.ai/docs|do');
    expect(linked).toContain('… _(truncated)_');
  });

  it('composes the gear+bold wrap with the internal-note prefix', () => {
    const text = messageBodyText({
      authorKind: 'system',
      authorName: null,
      internal: true,
      body: 'Agent requested handover: billing question',
    });
    expect(text).toBe(':lock: _Internal note_\n:gear: *Agent requested handover: billing question*');
  });
});

describe('statusChangedText', () => {
  it('renders known and unknown statuses', () => {
    expect(statusChangedText('closed')).toBe(':white_check_mark: *Conversation is resolved.*');
    expect(statusChangedText('open')).toContain('Conversation reopened');
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
    expect(line).toContain('taken over by *Kim &lt;ops&gt;*');
    expect(line).toContain('assigned to *Ada*');
    expect(line).toContain('needs attention');
  });

  it('replaces the status line with a resolved banner once closed', () => {
    const line = parentStateLine({
      status: 'closed',
      needsHumanAttention: false,
      claimedBy: null,
      assignedTo: 'Ada',
    });
    expect(line).toBe(':white_check_mark: *Conversation is resolved.*');
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

describe('approval value codec', () => {
  it('roundtrips subject refs', () => {
    const value = encodeApprovalValue('crm_merge_proposal', 'cmp_abc123');
    expect(value).toBe('crm_merge_proposal:cmp_abc123');
    expect(parseApprovalValue(value)).toEqual({
      subjectType: 'crm_merge_proposal',
      subjectId: 'cmp_abc123',
      fingerprint: null,
    });
  });

  it('carries the draft fingerprint of the message the button was rendered on', () => {
    const value = encodeApprovalValue('outreach_proposal', 'oprp_abc123', 'deadbeef');
    expect(value).toBe('outreach_proposal:oprp_abc123#deadbeef');
    expect(parseApprovalValue(value)).toEqual({
      subjectType: 'outreach_proposal',
      subjectId: 'oprp_abc123',
      fingerprint: 'deadbeef',
    });
  });

  it('rejects unknown subject types and malformed values', () => {
    expect(parseApprovalValue('unknown_thing:xyz')).toBeNull();
    expect(parseApprovalValue('crm_merge_proposal:')).toBeNull();
    expect(parseApprovalValue('no-separator')).toBeNull();
    expect(parseApprovalValue(':orphan')).toBeNull();
    expect(parseApprovalValue('outreach_proposal:#deadbeef')).toBeNull();
  });
});

describe('approval texts', () => {
  it('renders a merge proposal with escaped labels', () => {
    const text = mergeProposalApprovalText({
      contactALabel: 'Ada <ada@example.com>',
      contactBLabel: 'A. Lovelace <ada.l@example.com>',
      keeperLabel: 'Ada <ada@example.com>',
      confidence: 'high',
      dashboardUrl: 'https://app.example.com/dashboard',
    });
    expect(text).toContain('*Duplicate contacts — merge proposed*');
    expect(text).toContain('Ada &lt;ada@example.com&gt;');
    expect(text).toContain('high confidence');
    expect(text).toContain('<https://app.example.com/dashboard|Review in Munin>');
  });

  it('renders an outreach draft with subject and the full quoted body', () => {
    const body = ['Hi Ada,', '', 'We shipped the thing — want a walkthrough?', '', 'Kjell'].join(
      '\n',
    );
    const text = outreachProposalApprovalText({
      kind: 'initial',
      campaignName: 'Spring launch',
      contactLabel: 'Ada Lovelace',
      draftSubject: 'Hello there',
      draftBody: body,
      dashboardUrl: 'https://app.example.com/dashboard',
    });
    expect(text).toContain('*Outreach draft awaiting approval* — initial for *Spring launch*');
    expect(text).toContain('*Subject:* Hello there');
    for (const line of body.split('\n')) expect(text).toContain(`> ${line}`);
    expect(text).toContain('<https://app.example.com/dashboard|Review in Munin>');
    expect(text).not.toContain('truncated');
  });

  it('keeps a long outreach body within the Slack section limit and points at the dashboard', () => {
    const text = outreachProposalApprovalText({
      kind: 'initial',
      campaignName: 'Spring launch',
      contactLabel: 'Ada Lovelace',
      draftSubject: null,
      draftBody: Array.from({ length: 400 }, (_, i) => `line ${i} ${'y'.repeat(40)}`).join('\n'),
      dashboardUrl: 'https://app.example.com/dashboard',
    });
    expect(text).toContain('truncated — open the full draft in Munin');
    expect(text.length).toBeLessThanOrEqual(3000);
    expect(text.endsWith('<https://app.example.com/dashboard|Review in Munin>')).toBe(true);
  });

  it('escapes the outreach body without splitting an entity at the truncation point', () => {
    const text = outreachProposalApprovalText({
      kind: 'initial',
      campaignName: 'Spring',
      contactLabel: 'Ada',
      draftSubject: null,
      draftBody: `${'z'.repeat(2900)}${'<&>'.repeat(50)}`,
      dashboardUrl: 'https://app.example.com/dashboard',
    });
    expect(text.length).toBeLessThanOrEqual(3000);
    expect(text).not.toMatch(/&[a-z]*(\n|$)/);
  });

  it('renders a KB candidate with and without a proposed target', () => {
    const withTarget = kbCandidateApprovalText({
      title: 'Weekend hours',
      proposedTargetSpaceSlug: 'support-faq',
      sourceConversationId: 'ccv_1',
      dashboardUrl: 'https://app.example.com/dashboard',
    });
    expect(withTarget).toContain('*KB draft awaiting review* — *Weekend hours*');
    expect(withTarget).toContain('*Proposed space:* support-faq');
    expect(withTarget).toContain('Drafted from a resolved conversation');

    const withoutTarget = kbCandidateApprovalText({
      title: 'Weekend hours',
      proposedTargetSpaceSlug: null,
      sourceConversationId: null,
      dashboardUrl: 'https://app.example.com/dashboard',
    });
    expect(withoutTarget).toContain('No target space proposed');
    expect(withoutTarget).not.toContain('resolved conversation');
  });
});

describe('approvalBlocks', () => {
  const value = encodeApprovalValue('outreach_proposal', 'oprp_1');

  it('shows approve + dismiss buttons while pending', () => {
    const blocks = approvalBlocks('body', value, { approveLabel: 'Approve & send' }, null);
    expect(blocks).toHaveLength(2);
    const actions = blocks[1] as unknown as { elements: Array<Record<string, unknown>> };
    expect(actions.elements.map((e) => (e.text as { text: string }).text)).toEqual([
      'Approve & send',
      'Dismiss',
    ]);
    expect(actions.elements.every((e) => e.value === value)).toBe(true);
  });

  it('omits the approve button when no label is given', () => {
    const blocks = approvalBlocks('body', value, { approveLabel: null }, null);
    const actions = blocks[1] as unknown as { elements: Array<Record<string, unknown>> };
    expect(actions.elements.map((e) => e.action_id)).toEqual([APPROVAL_DISMISS_ACTION_ID]);
  });

  it('drops buttons and appends the outcome line once resolved', () => {
    const blocks = approvalBlocks(
      'body',
      value,
      { approveLabel: 'Approve & send' },
      { outcome: 'sent', decidedByName: 'Kjell' },
    );
    expect(blocks).toHaveLength(1);
    const section = blocks[0] as unknown as { text: { text: string } };
    expect(section.text.text).toContain('*Approved — email sent* by *Kjell*');
  });

  it('covers every outcome line', () => {
    expect(approvalResolvedLine('applied', null)).toContain('Merge applied');
    expect(approvalResolvedLine('published', 'A')).toContain('Published to the knowledge base');
    expect(approvalResolvedLine('dismissed', null)).toContain('Dismissed');
  });

});

describe('outreachCampaignParentText', () => {
  it('shows the pending count with a dashboard link', () => {
    const text = outreachCampaignParentText('Spring <launch>', 3, 'https://app.example.com/dashboard');
    expect(text).toContain('*Outreach drafts awaiting approval — Spring &lt;launch&gt;*');
    expect(text).toContain('3 drafts pending');
    expect(text).toContain('<https://app.example.com/dashboard|Review all in Munin>');
  });

  it('uses the singular noun for one pending draft', () => {
    expect(outreachCampaignParentText('Spring', 1, 'https://x')).toContain('1 draft pending');
  });

  it('flips to an all-handled banner at zero pending', () => {
    const text = outreachCampaignParentText('Spring', 0, 'https://x');
    expect(text).toContain('*All outreach drafts handled — Spring*');
    expect(text).not.toContain('pending');
  });

  it('renders the moved notice for a rotated parent', () => {
    const text = outreachCampaignParentMovedText('Spring <launch>');
    expect(text).toContain('*Outreach drafts — Spring &lt;launch&gt;*');
    expect(text).toContain('continued in a newer thread');
  });
});

describe('cmsEntryPublishedText', () => {
  it('links the live article and escapes the title', () => {
    const text = cmsEntryPublishedText({
      title: 'Spring <menu> is here',
      collectionSlug: 'blog',
      locale: 'nb',
      url: 'https://www.example.com/blog/spring-menu',
    });
    expect(text).toContain(':rocket: *Published* — *Spring &lt;menu&gt; is here*');
    expect(text).toContain('_blog · nb_');
    expect(text).toContain('<https://www.example.com/blog/spring-menu|Read it live>');
  });

  it('omits the link line when the collection has no live URL', () => {
    const text = cmsEntryPublishedText({
      title: 'Spring menu',
      collectionSlug: 'blog',
      locale: 'en',
      url: null,
    });
    expect(text).not.toContain('Read it live');
    expect(text.split('\n')).toHaveLength(2);
  });

  it('omits the metadata line when collection and locale are unknown', () => {
    const text = cmsEntryPublishedText({
      title: 'Spring menu',
      collectionSlug: null,
      locale: null,
      url: null,
    });
    expect(text.split('\n')).toHaveLength(1);
  });
});
