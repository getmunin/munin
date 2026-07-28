import { describe, it, expect } from 'vitest';
import {
  APPROVAL_DISMISS_ACTION_ID,
  APPROVAL_VIEW_ACTION_ID,
  approvalBlocks,
  approvalResolvedLine,
  authorLabel,
  encodeApprovalValue,
  escalationAlertText,
  escapeSlackText,
  kbCandidateApprovalText,
  mergeProposalApprovalText,
  messageText,
  outreachCampaignParentMovedText,
  outreachCampaignParentText,
  outreachDraftModalView,
  outreachProposalApprovalText,
  parentStateLine,
  parseApprovalValue,
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
    });
  });

  it('rejects unknown subject types and malformed values', () => {
    expect(parseApprovalValue('unknown_thing:xyz')).toBeNull();
    expect(parseApprovalValue('crm_merge_proposal:')).toBeNull();
    expect(parseApprovalValue('no-separator')).toBeNull();
    expect(parseApprovalValue(':orphan')).toBeNull();
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

  it('renders an outreach draft with subject and truncated quoted preview', () => {
    const text = outreachProposalApprovalText({
      kind: 'initial',
      campaignName: 'Spring launch',
      contactLabel: 'Ada Lovelace',
      draftSubject: 'Hello there',
      draftBodyPreview: 'x'.repeat(600),
      dashboardUrl: 'https://app.example.com/dashboard',
    });
    expect(text).toContain('*Outreach draft awaiting approval* — initial for *Spring launch*');
    expect(text).toContain('*Subject:* Hello there');
    expect(text).toContain('> x');
    expect(text).toContain('truncated');
    expect(text).not.toContain('x'.repeat(600));
  });

  it('keeps the outreach preview short so the thread reply stays compact', () => {
    const text = outreachProposalApprovalText({
      kind: 'initial',
      campaignName: 'Spring launch',
      contactLabel: 'Ada Lovelace',
      draftSubject: null,
      draftBodyPreview: 'y'.repeat(300),
      dashboardUrl: 'https://app.example.com/dashboard',
    });
    expect(text).toContain('truncated');
    expect(text).not.toContain('y'.repeat(250));
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

  it('adds a view button between approve and dismiss when a view label is given', () => {
    const blocks = approvalBlocks(
      'body',
      value,
      { approveLabel: 'Approve & send', viewLabel: 'View full draft' },
      null,
    );
    const actions = blocks[1] as unknown as { elements: Array<Record<string, unknown>> };
    expect(actions.elements.map((e) => e.action_id)).toEqual([
      'munin_approval_approve',
      APPROVAL_VIEW_ACTION_ID,
      APPROVAL_DISMISS_ACTION_ID,
    ]);
    expect(actions.elements.every((e) => e.value === value)).toBe(true);
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

describe('outreachDraftModalView', () => {
  it('renders header fields and the full body', () => {
    const view = outreachDraftModalView({
      kind: 'initial',
      campaignName: 'Spring launch',
      contactLabel: 'Ada <ada@example.com>',
      draftSubject: 'Hello there',
      draftBody: 'Full body text',
    }) as { type: string; blocks: Array<{ type: string; text?: { text: string } }> };
    expect(view.type).toBe('modal');
    expect(view.blocks[0]!.text!.text).toContain('*Campaign:* Spring launch · initial');
    expect(view.blocks[0]!.text!.text).toContain('Ada &lt;ada@example.com&gt;');
    expect(view.blocks[0]!.text!.text).toContain('*Subject:* Hello there');
    expect(view.blocks[1]!.type).toBe('divider');
    expect(view.blocks[2]!.text!.text).toBe('Full body text');
  });

  it('splits long bodies into multiple sections within the block text limit', () => {
    const body = Array.from({ length: 200 }, (_, i) => `line ${i} ${'z'.repeat(40)}`).join('\n');
    const view = outreachDraftModalView({
      kind: 'reply',
      campaignName: 'Spring',
      contactLabel: 'Ada',
      draftSubject: null,
      draftBody: body,
    }) as { blocks: Array<{ type: string; text?: { text: string } }> };
    const sections = view.blocks.slice(2);
    expect(sections.length).toBeGreaterThan(1);
    for (const section of sections) {
      expect(section.text!.text.length).toBeLessThanOrEqual(2900);
    }
    expect(sections.map((s) => s.text!.text).join('\n')).toBe(body);
  });
});
