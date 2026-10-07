import { describe, it, expect } from 'vitest';
import {
  APPROVAL_DISMISS_ACTION_ID,
  approvalBlocks,
  approvalResolvedLine,
  authorLabel,
  socialDraftApprovalText,
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
  isSharedRoutePrompt,
  MAX_SHARED_ROUTE_PROMPT_ORGS,
  dismissSharedRoutePrompt,
  resolveSharedRoutePrompt,
  sharedRouteDoneLine,
  sharedRoutePromptBlocks,
  sharedRoutePromptIntegrationIds,
  parseWorkspaceRouteValue,
  updateWorkspaceRoutePrompt,
  withOrgLabel,
  workspaceRouteOutcomeLine,
  workspaceRoutePromptBlocks,
  workspaceRouteValue,
  type ConversationSnapshot,
  type SlackBlock,
} from './slack-projection.ts';

const conv: ConversationSnapshot = {
  displayId: 42,
  subject: 'Refund for order <#1001>',
  channelType: 'email',
  channelName: 'Support inbox',
  contactName: 'Ada Lovelace',
  contactEmail: 'ada@example.com',
  contactPhone: null,
  dashboardUrl: 'https://app.example.com/o/org_0123456789abcdefghijkl/dashboard/conversations/cnv_7',
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
    expect(text).toContain('<https://app.example.com/o/org_0123456789abcdefghijkl/dashboard/conversations/cnv_7|Open in Munin>');
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
    expect(avatarKey('+4712345678')).toBe('default');
    expect(avatarKey('+47 12 34 56 78')).toBe('default');
  });
});

describe('speakerIdentity', () => {
  it('gives system messages the same plain Munin identity as agent messages, no icon override', () => {
    expect(speakerIdentity('system', null)).toEqual({ username: 'Munin' });
    expect(speakerIdentity('agent', null)).toEqual({ username: 'Munin' });
  });

  it('routes a digit-led end_user name to the default avatar', () => {
    expect(speakerIdentity('end_user', '+4712345678')).toEqual({
      username: '+4712345678',
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

  it('renders a caller turn that transcribed no speech as a placeholder, never empty text', () => {
    expect(
      messageBodyText({
        authorKind: 'end_user',
        authorName: '+47 88 88 88 88',
        internal: false,
        body: '',
        noSpeech: true,
      }),
    ).toBe('_No speech transcribed_');
    expect(
      messageText({
        authorKind: 'end_user',
        authorName: '+47 88 88 88 88',
        internal: false,
        body: '',
        noSpeech: true,
      }),
    ).toContain('> _No speech transcribed_');
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
      dashboardUrl: 'https://app.example.com/o/org_0123456789abcdefghijkl/dashboard/review/kbc_1',
    });
    expect(text).toContain('*Duplicate contacts — merge proposed*');
    expect(text).toContain('Ada &lt;ada@example.com&gt;');
    expect(text).toContain('high confidence');
    expect(text).toContain('<https://app.example.com/o/org_0123456789abcdefghijkl/dashboard/review/kbc_1|Review in Munin>');
  });

  it('renders an outreach draft with subject and the full quoted body', () => {
    const body = ['Hi Ada,', '', 'We shipped the thing — want a walkthrough?', '', 'Ola'].join(
      '\n',
    );
    const text = outreachProposalApprovalText({
      kind: 'initial',
      campaignName: 'Spring launch',
      contactLabel: 'Ada Lovelace',
      draftSubject: 'Hello there',
      draftBody: body,
      dashboardUrl: 'https://app.example.com/o/org_0123456789abcdefghijkl/dashboard/review/kbc_1',
    });
    expect(text).toContain('*Outreach draft awaiting approval* — initial for *Spring launch*');
    expect(text).toContain('*Subject:* Hello there');
    for (const line of body.split('\n')) expect(text).toContain(`> ${line}`);
    expect(text).toContain('<https://app.example.com/o/org_0123456789abcdefghijkl/dashboard/review/kbc_1|Review in Munin>');
    expect(text).not.toContain('truncated');
  });

  it('keeps a long outreach body within the Slack section limit and points at the dashboard', () => {
    const text = outreachProposalApprovalText({
      kind: 'initial',
      campaignName: 'Spring launch',
      contactLabel: 'Ada Lovelace',
      draftSubject: null,
      draftBody: Array.from({ length: 400 }, (_, i) => `line ${i} ${'y'.repeat(40)}`).join('\n'),
      dashboardUrl: 'https://app.example.com/o/org_0123456789abcdefghijkl/dashboard/review/kbc_1',
    });
    expect(text).toContain('truncated — open the full draft in Munin');
    expect(text.length).toBeLessThanOrEqual(3000);
    expect(text.endsWith('<https://app.example.com/o/org_0123456789abcdefghijkl/dashboard/review/kbc_1|Review in Munin>')).toBe(true);
  });

  it('escapes the outreach body without splitting an entity at the truncation point', () => {
    const text = outreachProposalApprovalText({
      kind: 'initial',
      campaignName: 'Spring',
      contactLabel: 'Ada',
      draftSubject: null,
      draftBody: `${'z'.repeat(2900)}${'<&>'.repeat(50)}`,
      dashboardUrl: 'https://app.example.com/o/org_0123456789abcdefghijkl/dashboard/review/kbc_1',
    });
    expect(text.length).toBeLessThanOrEqual(3000);
    expect(text).not.toMatch(/&[a-z]*(\n|$)/);
  });

  it('renders a KB candidate with and without a proposed target', () => {
    const withTarget = kbCandidateApprovalText({
      title: 'Weekend hours',
      proposedTargetSpaceSlug: 'support-faq',
      sourceConversationId: 'ccv_1',
      dashboardUrl: 'https://app.example.com/o/org_0123456789abcdefghijkl/dashboard/review/kbc_1',
    });
    expect(withTarget).toContain('*KB draft awaiting review* — *Weekend hours*');
    expect(withTarget).toContain('*Proposed space:* support-faq');
    expect(withTarget).toContain('Drafted from a resolved conversation');

    const withoutTarget = kbCandidateApprovalText({
      title: 'Weekend hours',
      proposedTargetSpaceSlug: null,
      sourceConversationId: null,
      dashboardUrl: 'https://app.example.com/o/org_0123456789abcdefghijkl/dashboard/review/kbc_1',
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
      { outcome: 'sent', decidedByName: 'Ola' },
    );
    expect(blocks).toHaveLength(1);
    const section = blocks[0] as unknown as { text: { text: string } };
    expect(section.text.text).toContain('*Approved — email sent* by *Ola*');
  });

  it('covers every outcome line', () => {
    expect(approvalResolvedLine('applied', null)).toContain('Merge applied');
    expect(approvalResolvedLine('published', 'A')).toContain('Published to the knowledge base');
    expect(approvalResolvedLine('dismissed', null)).toContain('Dismissed');
  });

});

describe('outreachCampaignParentText', () => {
  it('shows the pending count with a dashboard link', () => {
    const text = outreachCampaignParentText('Spring <launch>', 3, 'https://app.example.com/o/org_0123456789abcdefghijkl/dashboard/review');
    expect(text).toContain('*Outreach drafts awaiting approval — Spring &lt;launch&gt;*');
    expect(text).toContain('3 drafts pending');
    expect(text).toContain('<https://app.example.com/o/org_0123456789abcdefghijkl/dashboard/review|Review all in Munin>');
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

describe('socialDraftApprovalText', () => {
  const snap = {
    platformName: 'LinkedIn',
    variantLabel: null,
    body: 'A thought worth sharing.',
    shareUrl: null,
    bodyChars: 24,
    maxBodyChars: 3000,
    dashboardUrl: 'https://munin.example.test/dashboard/review',
  };

  it('tells the approver the post goes out under their own name', () => {
    expect(socialDraftApprovalText(snap)).toContain('your own LinkedIn account');
  });

  it('says a page post is not signed by the person clicking approve', () => {
    const text = socialDraftApprovalText({
      ...snap,
      platformName: 'Facebook',
      postsAsPage: true,
    });
    expect(text).toContain("organisation's Facebook page");
    expect(text).not.toContain('your own Facebook account');
  });

  it('quotes a short post in full without a truncation marker', () => {
    const text = socialDraftApprovalText({ ...snap, body: 'Line one\n\nLine two' });
    expect(text).toContain('> Line one\n> \n> Line two');
    expect(text).not.toContain('read the full post in Munin');
  });

  it('previews only the first lines of a long post', () => {
    const body = Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1}`).join('\n\n');
    const text = socialDraftApprovalText({ ...snap, body });
    expect(text).toContain('> Paragraph 1');
    expect(text).toContain('> Paragraph 3');
    expect(text).not.toContain('Paragraph 4');
    expect(text).toContain('> … _(read the full post in Munin)_');
    expect(text).not.toMatch(/> \n> …/);
  });

  it('clips a single long paragraph at a word boundary', () => {
    const body = 'word '.repeat(200).trim();
    const text = socialDraftApprovalText({ ...snap, body });
    const quoted = text.split('\n').filter((line) => line.startsWith('> '));
    expect(quoted).toHaveLength(2);
    expect(quoted[0]!.length).toBeLessThanOrEqual(410);
    expect(quoted[0]).toMatch(/word…$/);
  });

  it('labels the share link without its tracking query string', () => {
    const text = socialDraftApprovalText({
      ...snap,
      shareUrl: 'https://www.example.test/no/blog/post/?utm_source=linkedin&utm_medium=social',
    });
    expect(text).toContain(
      '*Link:* <https://www.example.test/no/blog/post/?utm_source=linkedin&utm_medium=social|example.test/no/blog/post>',
    );
  });
});

describe('withOrgLabel', () => {
  it('leaves a message untouched when no org name is given', () => {
    const message = { channel: 'C1', text: 'hello', blocks: [{ type: 'section' }] };
    expect(withOrgLabel(message, null)).toBe(message);
  });

  it('prefixes the text of a text-only message without inventing blocks', () => {
    const labeled = withOrgLabel({ channel: 'C1', text: 'hello' }, 'Acme <Ops>');
    expect(labeled).toEqual({ channel: 'C1', text: ':office: *Acme &lt;Ops&gt;*\nhello' });
  });

  it('puts a context block above existing blocks and prefixes the fallback text', () => {
    const labeled = withOrgLabel({ text: 'hello', blocks: [{ type: 'section' }] }, 'Acme');
    expect(labeled.text).toBe(':office: *Acme*\nhello');
    expect(labeled.blocks).toEqual([
      { type: 'context', elements: [{ type: 'mrkdwn', text: ':office: *Acme*' }] },
      { type: 'section' },
    ]);
  });

  it('keeps an empty block list empty so a cleared message stays cleared', () => {
    expect(withOrgLabel({ text: 'done', blocks: [] }, 'Acme').blocks).toEqual([]);
  });
});

describe('shared route prompt', () => {
  const orgs = [
    { integrationId: 'slk_a', orgName: 'Acme' },
    { integrationId: 'slk_b', orgName: null },
  ];

  function picker(blocks: SlackBlock[]) {
    const actions = blocks.find((b) => b.block_id === 'munin_route_shared');
    const elements = (actions?.elements ?? []) as Record<string, unknown>[];
    return {
      options: ((elements[0]?.options ?? []) as { value: string; text: { text: string } }[]).map(
        (o) => [o.value, o.text.text],
      ),
      buttons: elements.slice(1).map((e) => [e.action_id, e.value, e.style ?? null]),
    };
  }

  it('offers every org once in a single picker, with the buttons shown once', () => {
    const blocks = sharedRoutePromptBlocks(orgs);
    expect(blocks.map((b) => b.type)).toEqual(['section', 'divider', 'actions']);
    expect(picker(blocks)).toEqual({
      options: [
        ['all', 'All orgs'],
        ['slk_a', 'Acme'],
        ['slk_b', 'Unnamed org'],
      ],
      buttons: [
        ['munin_route_default', 'shared', 'primary'],
        ['munin_route_escalations', 'shared', null],
        ['munin_route_dismiss', 'shared', null],
      ],
    });
    expect(isSharedRoutePrompt(blocks)).toBe(true);
    expect(isSharedRoutePrompt(null)).toBe(false);
    expect(sharedRoutePromptIntegrationIds(blocks)).toEqual(['slk_a', 'slk_b']);
  });

  it('stays inside the Slack block and option limits however many orgs share the workspace', () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ integrationId: `slk_${i}`, orgName: `Org ${i}` }));
    const blocks = sharedRoutePromptBlocks(many);
    expect(picker(blocks).options).toHaveLength(MAX_SHARED_ROUTE_PROMPT_ORGS + 1);
    const allDone = resolveSharedRoutePrompt(
      blocks,
      sharedRoutePromptIntegrationIds(blocks).map((id) => ({ integrationId: id, line: id })),
    );
    expect(allDone.length).toBeLessThanOrEqual(50);
  });

  it('cuts an org name to the 75 characters a Slack option allows', () => {
    const blocks = sharedRoutePromptBlocks([
      { integrationId: 'slk_a', orgName: 'x'.repeat(80) },
      { integrationId: 'slk_b', orgName: 'Globex' },
    ]);
    expect(picker(blocks).options[1]![1]).toHaveLength(75);
  });

  it('drops a resolved org from the picker and lists it underneath', () => {
    const three = [...orgs, { integrationId: 'slk_c', orgName: 'Initech' }];
    const resolved = resolveSharedRoutePrompt(sharedRoutePromptBlocks(three), [
      { integrationId: 'slk_a', line: sharedRouteDoneLine('Acme', 'default', 'U1') },
    ]);
    expect(picker(resolved).options.map(([value]) => value)).toEqual(['all', 'slk_b', 'slk_c']);
    expect(resolved.at(-1)).toEqual({
      type: 'context',
      block_id: 'munin_route_done:slk_a',
      elements: [{ type: 'mrkdwn', text: ':white_check_mark: *Acme* · all conversations · set by <@U1>' }],
    });
  });

  it('hides the all-orgs option once a single org is left', () => {
    const resolved = resolveSharedRoutePrompt(sharedRoutePromptBlocks(orgs), [
      { integrationId: 'slk_a', line: 'done' },
    ]);
    expect(picker(resolved).options).toEqual([['slk_b', 'Unnamed org']]);
  });

  it('removes the picker once every org is resolved', () => {
    const resolved = resolveSharedRoutePrompt(sharedRoutePromptBlocks(orgs), [
      { integrationId: 'slk_a', line: 'a' },
      { integrationId: 'slk_b', line: 'b' },
    ]);
    expect(resolved.map((b) => b.block_id ?? b.type)).toEqual([
      'section',
      'divider',
      'munin_route_done:slk_a',
      'munin_route_done:slk_b',
    ]);
    expect(isSharedRoutePrompt(resolved)).toBe(false);
  });

  it('dismissing keeps earlier choices and drops the picker', () => {
    const partly = resolveSharedRoutePrompt(sharedRoutePromptBlocks(orgs), [
      { integrationId: 'slk_a', line: 'a' },
    ]);
    const dismissed = dismissSharedRoutePrompt(partly);
    expect(dismissed.map((b) => b.block_id ?? b.type)).toEqual([
      'section',
      'divider',
      'munin_route_done:slk_a',
      'context',
    ]);
    expect(JSON.stringify(dismissed.at(-1))).toContain('dashboard');
  });
});

describe('workspace route prompt', () => {
  it('names no org and points every button at the workspace', () => {
    const blocks = workspaceRoutePromptBlocks('T1');
    const values = (blocks[1]!.elements as Array<{ value: string }>).map((e) => e.value);
    expect(values).toEqual(['workspace:T1', 'workspace:T1', 'workspace:T1']);
    expect(JSON.stringify(blocks)).not.toContain(':office:');
  });

  it('parses only workspace button values', () => {
    expect(parseWorkspaceRouteValue(workspaceRouteValue('T1'))).toBe('T1');
    expect(parseWorkspaceRouteValue('workspace:')).toBeNull();
    expect(parseWorkspaceRouteValue('3f1c0a52-8d55-4b7e-9a51-6f7c2d1e0b9a')).toBeNull();
  });

  it('records an outcome above the buttons and keeps them while other orgs can still route', () => {
    const line = workspaceRouteOutcomeLine('Acme', 'Done.');
    const updated = updateWorkspaceRoutePrompt(workspaceRoutePromptBlocks('T1'), 'T1', line, true);
    expect(updated.map((b) => b.type)).toEqual(['section', 'section', 'actions']);
    expect(updated[1]).toEqual({ type: 'section', text: { type: 'mrkdwn', text: ':office: *Acme*\nDone.' } });
    const closed = updateWorkspaceRoutePrompt(updated, 'T1', workspaceRouteOutcomeLine(null, 'Also done.'), false);
    expect(closed.map((b) => b.type)).toEqual(['section', 'section', 'section']);
    expect(JSON.stringify(closed[2])).toContain('Unnamed org');
  });

  it('rebuilds the prompt when Slack sends no blocks back', () => {
    const updated = updateWorkspaceRoutePrompt(null, 'T1', 'Done.', true);
    expect(updated.map((b) => b.type)).toEqual(['section', 'section', 'actions']);
    expect(JSON.stringify(updated[2])).toContain('workspace:T1');
  });
});
