import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Db } from '@getmunin/db';
import {
  ActorIdentity,
  describeError,
  readApiBaseUrl,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { DB } from '../../common/db/db.module.ts';
import { ConvService } from '../conv/conv.service.ts';
import { ClaimedByOtherError, ConversationClaimsService } from '../conv/conv.claims.service.ts';
import { CmsConflictError, CmsInvalidError, CmsService } from '../cms/cms.service.ts';
import { CrmInvalidError, CrmService } from '../crm/crm.service.ts';
import { KbConflictError, KbInvalidError, KbNotFoundError, KbService } from '../kb/kb.service.ts';
import {
  CHANNELS_REQUIRING_HUMAN_APPROVAL,
  OutreachInvalidError,
  OutreachService,
} from '../outreach/outreach.service.ts';
import { SocialService } from '../social/social.service.ts';
import { SlackApiClient } from './slack-api.client.ts';
import { SlackUserMappingService } from './slack-user-mapping.service.ts';
import { SlackService, decryptSecretValue } from './slack.service.ts';
import {
  APPROVAL_APPROVE_ACTION_ID,
  APPROVAL_DISMISS_ACTION_ID,
  CLAIM_ACTION_ID,
  CLOSE_ACTION_ID,
  RELEASE_ACTION_ID,
  REOPEN_ACTION_ID,
  ROUTE_DEFAULT_ACTION_ID,
  ROUTE_DISMISS_ACTION_ID,
  ROUTE_ESCALATIONS_ACTION_ID,
  escapeSlackText,
  parseApprovalValue,
  parseWorkspaceRouteValue,
  routeConfirmedText,
  routeDismissedText,
  updateWorkspaceRoutePrompt,
  withOrgLabel,
  workspaceRouteOutcomeLine,
  type SlackBlock,
} from './slack-projection.ts';
import { isChannelShared, orgName, sharedChannelOrgName } from './slack-shared-channel.ts';

export interface CmsDraftDecider {
  publishEntry(input: { id: string; ifVersion: number }): Promise<unknown>;
  archiveEntry(input: { id: string; ifVersion: number }): Promise<unknown>;
}

export interface SocialDraftDecider {
  publishDraft(id: string, opts?: { fingerprint?: string | null }): Promise<unknown>;
  dismissDraft(id: string, reason?: string | null): Promise<unknown>;
}

const BlockActionsSchema = z.object({
  type: z.literal('block_actions'),
  user: z.object({ id: z.string().min(1) }),
  channel: z.object({ id: z.string().min(1) }).optional(),
  message: z
    .object({
      ts: z.string().min(1),
      blocks: z
        .array(z.object({ type: z.string(), block_id: z.string().optional() }).passthrough())
        .optional(),
    })
    .optional(),
  actions: z
    .array(z.object({ action_id: z.string().min(1), value: z.string().optional() }))
    .min(1),
});

const HANDLED_ACTIONS = new Set([
  CLAIM_ACTION_ID,
  CLOSE_ACTION_ID,
  REOPEN_ACTION_ID,
  RELEASE_ACTION_ID,
]);
const ROUTE_ACTIONS = new Set([
  ROUTE_DEFAULT_ACTION_ID,
  ROUTE_ESCALATIONS_ACTION_ID,
  ROUTE_DISMISS_ACTION_ID,
]);
const APPROVAL_ACTIONS = new Set([APPROVAL_APPROVE_ACTION_ID, APPROVAL_DISMISS_ACTION_ID]);

function routePurpose(actionId: string): 'default' | 'escalations' {
  return actionId === ROUTE_ESCALATIONS_ACTION_ID ? 'escalations' : 'default';
}

function unlinkedText(sharedOrgName: string | null): string {
  const org = sharedOrgName ? `*${escapeSlackText(sharedOrgName)}*` : 'the org';
  return `:no_entry: That action needs a linked Munin account — ask an admin to add you to ${org} with your Slack email.`;
}

@Injectable()
export class SlackInteractionsService {
  private readonly logger = new Logger(SlackInteractionsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SlackApiClient) private readonly api: SlackApiClient,
    @Inject(ConvService) private readonly conv: ConvService,
    @Inject(ConversationClaimsService) private readonly claims: ConversationClaimsService,
    @Inject(SlackUserMappingService) private readonly mapping: SlackUserMappingService,
    @Inject(SlackService) private readonly slack: SlackService,
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(OutreachService) private readonly outreach: OutreachService,
    @Inject(KbService) private readonly kb: KbService,
    @Inject(SocialService) private readonly social: SocialDraftDecider,
    @Inject(CmsService) private readonly cms: CmsDraftDecider,
  ) {}

  async processBlockActions(payload: Record<string, unknown>): Promise<void> {
    const parsed = BlockActionsSchema.safeParse(payload);
    if (!parsed.success) return;
    const routeAction = parsed.data.actions.find((a) => ROUTE_ACTIONS.has(a.action_id));
    if (routeAction?.value && parsed.data.channel) {
      const prompt = {
        actionId: routeAction.action_id,
        slackChannelId: parsed.data.channel.id,
        slackUserId: parsed.data.user.id,
        promptTs: parsed.data.message?.ts ?? null,
      };
      const teamId = parseWorkspaceRouteValue(routeAction.value);
      if (teamId) {
        await this.handleWorkspaceRoutePrompt({
          ...prompt,
          teamId,
          promptBlocks: parsed.data.message?.blocks ?? null,
        });
      } else {
        await this.handleRoutePrompt({ ...prompt, integrationId: routeAction.value });
      }
      return;
    }
    const approvalAction = parsed.data.actions.find((a) => APPROVAL_ACTIONS.has(a.action_id));
    if (approvalAction?.value) {
      await this.handleApprovalAction({
        actionId: approvalAction.action_id,
        value: approvalAction.value,
        slackChannelId: parsed.data.channel?.id ?? null,
        slackUserId: parsed.data.user.id,
      });
      return;
    }
    const action = parsed.data.actions.find((a) => HANDLED_ACTIONS.has(a.action_id));
    if (!action?.value) return;
    const conversationId = action.value;
    const slackUserId = parsed.data.user.id;

    const [link] = await this.db
      .select()
      .from(schema.slackConversationLinks)
      .where(eq(schema.slackConversationLinks.conversationId, conversationId))
      .limit(1);
    if (!link) return;
    if (parsed.data.channel && parsed.data.channel.id !== link.slackChannelId) return;

    const [integration] = await this.db
      .select()
      .from(schema.slackIntegrations)
      .where(eq(schema.slackIntegrations.id, link.integrationId))
      .limit(1);
    if (!integration || !integration.active) return;

    const token = await decryptSecretValue(this.db, integration.encryptedBotToken);
    const userId = await this.mapping.resolveMuninUser(integration, slackUserId, token);
    if (!userId) {
      await this.notify(
        token,
        link,
        slackUserId,
        unlinkedText(await sharedChannelOrgName(this.db, integration, link.slackChannelId)),
      );
      return;
    }

    const actor = new ActorIdentity(
      'user',
      userId,
      integration.orgId,
      ['*'],
      ['admin'],
      undefined,
      undefined,
      undefined,
      userId,
    );
    try {
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
        const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
        await withContext(ctx, async () => {
          switch (action.action_id) {
            case CLAIM_ACTION_ID:
              await this.claims.claim({ conversationId });
              return;
            case RELEASE_ACTION_ID:
              await this.claims.release({ conversationId });
              return;
            case CLOSE_ACTION_ID:
              await this.conv.changeStatus({ id: conversationId, status: 'closed' });
              return;
            case REOPEN_ACTION_ID:
              await this.conv.changeStatus({ id: conversationId, status: 'open' });
              return;
            default:
              return;
          }
        });
      });
    } catch (err) {
      if (err instanceof ClaimedByOtherError) {
        await this.notify(
          token,
          link,
          slackUserId,
          action.action_id === RELEASE_ACTION_ID
            ? ':raised_hand: Only the person who took over this conversation can release it.'
            : ':raised_hand: Someone else has already taken over this conversation.',
        );
        return;
      }
      this.logger.error(
        `slack action ${action.action_id} failed for ${conversationId}: ${describeError(err)}`,
      );
    }
  }

  private async handleApprovalAction(input: {
    actionId: string;
    value: string;
    slackChannelId: string | null;
    slackUserId: string;
  }): Promise<void> {
    const subject = parseApprovalValue(input.value);
    if (!subject) return;

    const [link] = await this.db
      .select()
      .from(schema.slackNotificationLinks)
      .where(
        and(
          eq(schema.slackNotificationLinks.subjectType, subject.subjectType),
          eq(schema.slackNotificationLinks.subjectId, subject.subjectId),
        ),
      )
      .limit(1);
    if (!link) return;
    if (input.slackChannelId && input.slackChannelId !== link.slackChannelId) return;

    const [integration] = await this.db
      .select()
      .from(schema.slackIntegrations)
      .where(eq(schema.slackIntegrations.id, link.integrationId))
      .limit(1);
    if (!integration || !integration.active) return;

    const token = await decryptSecretValue(this.db, integration.encryptedBotToken);
    const ephemeral = (text: string) =>
      this.api
        .postEphemeral({ token, channel: link.slackChannelId, user: input.slackUserId, text })
        .catch((err: unknown) => this.logger.warn(`ephemeral notice failed: ${describeError(err)}`));

    const userId = await this.mapping.resolveMuninUser(integration, input.slackUserId, token);
    if (!userId) {
      await ephemeral(
        unlinkedText(await sharedChannelOrgName(this.db, integration, link.slackChannelId)),
      );
      return;
    }

    const approve = input.actionId === APPROVAL_APPROVE_ACTION_ID;
    const actor = new ActorIdentity(
      'user',
      userId,
      integration.orgId,
      ['*'],
      ['admin'],
      undefined,
      undefined,
      undefined,
      userId,
    );
    try {
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
        const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
        await withContext(ctx, async () => {
          switch (subject.subjectType) {
            case 'crm_merge_proposal':
              if (approve)
                await this.crm.applyMergeProposal({
                  id: subject.subjectId,
                  fingerprint: subject.fingerprint ?? '',
                });
              else await this.crm.dismissMergeProposal({ id: subject.subjectId });
              return;
            case 'outreach_proposal':
              if (approve) {
                const proposal = await this.outreach.getProposal(subject.subjectId);
                const channelType = proposal.delivery?.channelType ?? 'email';
                if (CHANNELS_REQUIRING_HUMAN_APPROVAL.includes(channelType)) {
                  await ephemeral(
                    `:telephone_receiver: ${channelType === 'voice' ? 'Calls' : 'Text messages'} are approved in the Munin dashboard, not from Slack — open the inbox to review and send this one.`,
                  );
                  return;
                }
                await this.outreach.approveProposal(subject.subjectId, {
                  publicBaseUrl: readApiBaseUrl(),
                  fingerprint: subject.fingerprint ?? '',
                });
              } else {
                await this.outreach.dismissProposal({ id: subject.subjectId });
              }
              return;
            case 'cms_draft_entry': {
              const version = subject.fingerprint ? Number(subject.fingerprint) : NaN;
              if (!Number.isInteger(version)) {
                await ephemeral(
                  ':no_entry: This card is out of date — open the entry in Munin and decide it there.',
                );
                return;
              }
              if (approve) {
                await this.cms.publishEntry({ id: subject.subjectId, ifVersion: version });
              } else {
                await this.cms.archiveEntry({ id: subject.subjectId, ifVersion: version });
              }
              return;
            }
            case 'social_post_draft': {
              if (approve) {
                await this.social.publishDraft(subject.subjectId, {
                  fingerprint: subject.fingerprint,
                });
              } else {
                await this.social.dismissDraft(subject.subjectId);
              }
              return;
            }
            case 'kb_curation_candidate': {
              if (approve) {
                const candidate = await this.kb.getCurationCandidate(subject.subjectId);
                if (!candidate.proposedTargetSpaceSlug) {
                  throw new KbInvalidError(
                    'this draft has no proposed target space — publish it from the dashboard where you can pick one',
                  );
                }
                await this.kb.publishCurationCandidate({
                  candidateDocumentId: subject.subjectId,
                  targetSpaceSlug: candidate.proposedTargetSpaceSlug,
                  ifVersion: Number(subject.fingerprint),
                });
              } else {
                const doc = await this.kb.getDocument(subject.subjectId);
                await this.kb.dismissCurationCandidate({
                  id: doc.id,
                  ifVersion: doc.version,
                });
              }
              return;
            }
          }
        });
      });
    } catch (err) {
      if (
        err instanceof CmsInvalidError ||
        err instanceof CmsConflictError ||
        err instanceof CrmInvalidError ||
        err instanceof OutreachInvalidError ||
        err instanceof KbInvalidError ||
        err instanceof KbConflictError ||
        err instanceof KbNotFoundError ||
        err instanceof HttpException
      ) {
        await ephemeral(`:no_entry: ${err.message}`);
        return;
      }
      this.logger.error(
        `slack approval ${input.actionId} failed for ${subject.subjectType}:${subject.subjectId}: ${describeError(err)}`,
      );
    }
  }

  private async handleRoutePrompt(input: {
    actionId: string;
    integrationId: string;
    slackChannelId: string;
    slackUserId: string;
    promptTs: string | null;
  }): Promise<void> {
    const [integration] = await this.db
      .select()
      .from(schema.slackIntegrations)
      .where(eq(schema.slackIntegrations.id, input.integrationId))
      .limit(1);
    if (!integration || !integration.active) return;

    const token = await decryptSecretValue(this.db, integration.encryptedBotToken);
    const ephemeral = this.ephemeralTo(token, input.slackChannelId, input.slackUserId);
    const promptOrgName = (await isChannelShared(this.db, integration, input.slackChannelId))
      ? await orgName(this.db, integration.orgId)
      : null;

    const userId = await this.mapping.resolveMuninUser(integration, input.slackUserId, token);
    if (!userId) {
      await ephemeral(unlinkedText(promptOrgName));
      return;
    }

    const resolvePrompt = async (outcome: string) => {
      if (!input.promptTs) return;
      await this.updatePrompt(
        token,
        input.slackChannelId,
        input.promptTs,
        withOrgLabel({ text: outcome }, promptOrgName).text,
      );
    };

    if (input.actionId === ROUTE_DISMISS_ACTION_ID) {
      await resolvePrompt(routeDismissedText());
      return;
    }

    if (!(await this.isOrgAdmin(integration.orgId, userId))) {
      await ephemeral(
        promptOrgName
          ? `:no_entry: Only owners and admins of *${escapeSlackText(promptOrgName)}* can change its Slack routing.`
          : ':no_entry: Only org owners and admins can change Slack routing.',
      );
      return;
    }

    const purpose = routePurpose(input.actionId);
    const failure = await this.routeAsMember(integration, userId, input, purpose);
    if (failure) {
      await ephemeral(failure);
      return;
    }
    await resolvePrompt(routeConfirmedText(purpose, input.slackUserId));
  }

  private async handleWorkspaceRoutePrompt(input: {
    actionId: string;
    teamId: string;
    slackChannelId: string;
    slackUserId: string;
    promptTs: string | null;
    promptBlocks: SlackBlock[] | null;
  }): Promise<void> {
    const integrations = await this.db
      .select()
      .from(schema.slackIntegrations)
      .where(
        and(
          eq(schema.slackIntegrations.teamId, input.teamId),
          eq(schema.slackIntegrations.active, true),
        ),
      )
      .orderBy(schema.slackIntegrations.createdAt);
    if (integrations.length === 0) return;

    const routed = await this.db
      .select({ integrationId: schema.slackChannelRoutes.integrationId })
      .from(schema.slackChannelRoutes)
      .where(
        and(
          eq(schema.slackChannelRoutes.teamId, input.teamId),
          eq(schema.slackChannelRoutes.slackChannelId, input.slackChannelId),
        ),
      );
    const routedIds = new Set(routed.map((route) => route.integrationId));

    const token = await decryptSecretValue(this.db, integrations[0]!.encryptedBotToken);
    const ephemeral = this.ephemeralTo(token, input.slackChannelId, input.slackUserId);

    let linked = false;
    const administered: Array<{ integration: (typeof integrations)[number]; userId: string }> = [];
    for (const integration of integrations) {
      const userId = await this.mapping.resolveMuninUser(integration, input.slackUserId, token);
      if (!userId) continue;
      linked = true;
      if (!routedIds.has(integration.id) && (await this.isOrgAdmin(integration.orgId, userId))) {
        administered.push({ integration, userId });
      }
    }
    if (!linked) {
      await ephemeral(unlinkedText(null));
      return;
    }

    const updatePrompt = async (text: string, line: string, keepButtons: boolean) => {
      if (!input.promptTs) return;
      await this.updatePrompt(
        token,
        input.slackChannelId,
        input.promptTs,
        text,
        updateWorkspaceRoutePrompt(input.promptBlocks, input.teamId, line, keepButtons),
      );
    };

    if (input.actionId === ROUTE_DISMISS_ACTION_ID) {
      await updatePrompt(routeDismissedText(), routeDismissedText(), false);
      return;
    }

    if (administered.length === 0) {
      await ephemeral(
        ':no_entry: Only owners and admins can route a Munin org into this channel, and you are not one for any org here that is not routed into it yet.',
      );
      return;
    }
    if (administered.length > 1) {
      const names = await Promise.all(
        administered.map(async ({ integration }) => {
          const name = await orgName(this.db, integration.orgId);
          return `*${escapeSlackText(name ?? 'Unnamed org')}*`;
        }),
      );
      await ephemeral(
        `:information_source: You are an owner or admin of several Munin orgs here (${names.join(', ')}). Route the one you mean from its dashboard (Settings → Integrations) or with slack_set_routing.`,
      );
      return;
    }

    const { integration, userId } = administered[0]!;
    const purpose = routePurpose(input.actionId);
    const failure = await this.routeAsMember(integration, userId, input, purpose);
    if (failure) {
      await ephemeral(failure);
      return;
    }
    const name = await orgName(this.db, integration.orgId);
    const outcome = routeConfirmedText(purpose, input.slackUserId);
    const unroutedLeft = integrations.some(
      (other) => other.id !== integration.id && !routedIds.has(other.id),
    );
    await updatePrompt(
      withOrgLabel({ text: outcome }, name ?? 'Unnamed org').text,
      workspaceRouteOutcomeLine(name, outcome),
      unroutedLeft,
    );
  }

  private async isOrgAdmin(orgId: string, userId: string): Promise<boolean> {
    const [membership] = await this.db
      .select({ role: schema.orgMembers.role })
      .from(schema.orgMembers)
      .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.userId, userId)))
      .limit(1);
    return membership !== undefined && ['owner', 'admin'].includes(membership.role);
  }

  private async routeAsMember(
    integration: typeof schema.slackIntegrations.$inferSelect,
    userId: string,
    input: { actionId: string; slackChannelId: string; slackUserId: string },
    purpose: 'default' | 'escalations',
  ): Promise<string | null> {
    const actor = new ActorIdentity(
      'user',
      userId,
      integration.orgId,
      ['*'],
      ['admin'],
      undefined,
      undefined,
      undefined,
      userId,
    );
    try {
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
        const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
        await withContext(ctx, () =>
          this.slack.setRouting(
            { slackChannelId: input.slackChannelId, purpose },
            { verifiedSlackUserId: input.slackUserId },
          ),
        );
      });
      return null;
    } catch (err) {
      if (err instanceof HttpException) return `:no_entry: ${err.message}`;
      this.logger.error(
        `slack route prompt ${input.actionId} failed for ${input.slackChannelId}: ${describeError(err)}`,
      );
      return ':warning: Munin could not save that routing — try again, or set it from the dashboard.';
    }
  }

  private ephemeralTo(token: string, channel: string, user: string) {
    return (text: string) =>
      this.api
        .postEphemeral({ token, channel, user, text })
        .catch((err: unknown) => this.logger.warn(`ephemeral notice failed: ${describeError(err)}`));
  }

  private async updatePrompt(
    token: string,
    channel: string,
    ts: string,
    text: string,
    blocks: SlackBlock[] = [],
  ): Promise<void> {
    try {
      await this.api.updateMessage({ token, channel, ts, text, blocks });
    } catch (err) {
      this.logger.warn(`route prompt update failed: ${describeError(err)}`);
    }
  }

  private async notify(
    token: string,
    link: typeof schema.slackConversationLinks.$inferSelect,
    slackUserId: string,
    text: string,
  ): Promise<void> {
    try {
      await this.api.postEphemeral({
        token,
        channel: link.slackChannelId,
        user: slackUserId,
        threadTs: link.slackThreadTs,
        text,
      });
    } catch (err) {
      this.logger.warn(`ephemeral notice failed: ${describeError(err)}`);
    }
  }
}
