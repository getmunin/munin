import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ActorIdentity, WebhookDispatcher, withContext, type RequestContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { ConvService } from '../conv/conv.service.ts';
import { ConversationClaimsService } from '../conv/conv.claims.service.ts';
import { AlertsService } from '../system-alerts/system-alerts.service.ts';
import { CuratorJobsService } from '../curator/curator-jobs.service.ts';
import { stubAttachmentGateway } from '../conv/attachments/conv-attachments.test-stub.ts';
import { CredentialHandoffService } from '../credential-handoff/credential-handoff.service.ts';
import { CredentialTargetRegistry } from '../credential-handoff/credential-target.ts';
import {
  TeamsApiClient,
  TeamsApiError,
  type TeamsActivity,
  type TeamsBotCredentials,
  type TeamsChannel,
  type TeamsMember,
} from './teams-api.client.ts';
import { TeamsBridgeWorker } from './teams-bridge.worker.ts';
import { TeamsEventSink } from './teams-event-sink.ts';
import { TeamsInboundService } from './teams-inbound.service.ts';
import { TeamsInteractionsService } from './teams-interactions.service.ts';
import { TeamsUserMappingService } from './teams-user-mapping.service.ts';
import type { TeamsInboundActivity } from './teams-activity.ts';
import { TeamsService, encryptTeamsSecret } from './teams.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL ? null : 'Set TEST_DATABASE_URL to a Postgres URL to run teams bridge tests.';

const SERVICE_URL = 'https://smba.trafficmanager.net/emea/';
const TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const TEAM_ID = '19:team-general@thread.tacv2';
const CHANNEL_ID = '19:support@thread.tacv2';
const ESCALATION_CHANNEL_ID = '19:escalations@thread.tacv2';
const BOT_ID = '28:bot';

interface SentActivity {
  conversationId: string;
  activity: TeamsActivity;
  activityId: string;
}

class FakeTeamsApi extends TeamsApiClient {
  threads: Array<{ channelId: string; activity: TeamsActivity; activityId: string }> = [];
  sent: SentActivity[] = [];
  updates: Array<{ conversationId: string; activityId: string; activity: TeamsActivity }> = [];
  members = new Map<string, Partial<TeamsMember>>();
  channels: TeamsChannel[] = [
    { id: TEAM_ID, name: 'General' },
    { id: CHANNEL_ID, name: 'Support' },
    { id: ESCALATION_CHANNEL_ID, name: 'Escalations' },
  ];
  tokenError: TeamsApiError | null = null;
  sendError: TeamsApiError | null = null;
  private counter = 0;

  override acquireToken(_creds: TeamsBotCredentials): Promise<string> {
    if (this.tokenError) return Promise.reject(this.tokenError);
    return Promise.resolve('fake-token');
  }

  override createChannelThread(input: {
    creds: TeamsBotCredentials;
    serviceUrl: string;
    channelId: string;
    tenantId: string;
    activity: TeamsActivity;
  }) {
    if (this.sendError) return Promise.reject(this.sendError);
    const activityId = this.nextId();
    this.threads.push({ channelId: input.channelId, activity: input.activity, activityId });
    return Promise.resolve({ conversationId: `${input.channelId};messageid=${activityId}`, activityId });
  }

  override sendToConversation(input: {
    creds: TeamsBotCredentials;
    serviceUrl: string;
    conversationId: string;
    activity: TeamsActivity;
  }) {
    if (this.sendError) return Promise.reject(this.sendError);
    const activityId = this.nextId();
    this.sent.push({ conversationId: input.conversationId, activity: input.activity, activityId });
    return Promise.resolve({ activityId });
  }

  override updateActivity(input: {
    creds: TeamsBotCredentials;
    serviceUrl: string;
    conversationId: string;
    activityId: string;
    activity: TeamsActivity;
  }) {
    this.updates.push(input);
    return Promise.resolve();
  }

  override getMember(input: {
    creds: TeamsBotCredentials;
    serviceUrl: string;
    conversationId: string;
    memberId: string;
  }): Promise<TeamsMember> {
    const member = this.members.get(input.memberId);
    if (!member) return Promise.reject(new TeamsApiError(404, 'MemberNotFoundInConversation'));
    return Promise.resolve({
      id: input.memberId,
      aadObjectId: member.aadObjectId ?? null,
      name: member.name ?? null,
      email: member.email ?? null,
      userPrincipalName: member.userPrincipalName ?? null,
    });
  }

  override listTeamChannels(_input: { creds: TeamsBotCredentials; serviceUrl: string; teamId: string }) {
    return Promise.resolve(this.channels);
  }

  private nextId(): string {
    this.counter += 1;
    return `17000000000${String(this.counter).padStart(2, '0')}`;
  }
}

function cardVerbs(activity: TeamsActivity): Array<string | undefined> {
  const content = activity.attachments?.[0]?.content as { actions?: Array<{ verb?: string }> } | undefined;
  return (content?.actions ?? []).map((a) => a.verb);
}

(skipReason ? describe.skip : describe)('Teams bridge', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let orgId: string;
  let otherOrgId: string;
  let memberUserId: string;
  let memberEmail: string;
  let convChannelId: string;
  let contactId: string;
  let integrationId: string;
  let installedTeamId: string;
  let appId: string;
  let actor: ActorIdentity;
  let api: FakeTeamsApi;
  let dispatcher: WebhookDispatcher;
  let conv: ConvService;
  let claims: ConversationClaimsService;
  let displayIdSeq = 0;

  beforeAll(async () => {
    process.env.MUNIN_ENCRYPTION_KEY ??= 'teams-bridge-test-encryption-key';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    appDb = createDb(TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@'));

    const [org] = await db.insert(schema.orgs).values({ name: 'Teams Bridge Test Org' }).returning();
    orgId = org!.id;
    const [otherOrg] = await db.insert(schema.orgs).values({ name: 'Teams Other Org' }).returning();
    otherOrgId = otherOrg!.id;
    actor = new ActorIdentity('admin_agent', 'agt_teams_test', orgId, ['*'], ['admin']);

    memberEmail = `teams-op-${Date.now()}@example.com`;
    const [member] = await db
      .insert(schema.users)
      .values({ email: memberEmail, name: 'Kari Nordmann' })
      .returning();
    memberUserId = member!.id;
    await db.insert(schema.orgMembers).values({ orgId, userId: memberUserId });

    const [channel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'email', vendor: 'smtp', name: 'Support inbox' })
      .returning();
    convChannelId = channel!.id;
    const [contact] = await db
      .insert(schema.convContacts)
      .values({ orgId, name: 'Ola Nordmann', email: 'ola@example.no' })
      .returning();
    contactId = contact!.id;
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id IN (${orgId}, ${otherOrgId})`);
      await db.delete(schema.users).where(eq(schema.users.id, memberUserId));
    }
  });

  beforeEach(async () => {
    await db.delete(schema.teamsIntegrations).where(sql`org_id IN (${orgId}, ${otherOrgId})`);
    await db.execute(sql`DELETE FROM claims WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM curator_jobs WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_messages WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_conversations WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM events WHERE org_id = ${orgId}`);

    appId = randomUUID();
    const encryptedAppSecret = await encryptTeamsSecret(db, 'bot-client-secret');
    const [integration] = await db
      .insert(schema.teamsIntegrations)
      .values({ orgId, appId, botTenantId: TENANT_ID, encryptedAppSecret })
      .returning();
    integrationId = integration!.id;
    const [team] = await db
      .insert(schema.teamsInstalledTeams)
      .values({
        orgId,
        integrationId,
        teamId: TEAM_ID,
        teamName: 'Customer Care',
        tenantId: TENANT_ID,
        serviceUrl: SERVICE_URL,
      })
      .returning();
    installedTeamId = team!.id;
    await db.insert(schema.teamsChannelRoutes).values({
      orgId,
      integrationId,
      installedTeamId,
      teamsChannelId: CHANNEL_ID,
      teamsChannelName: 'Support',
      purpose: 'default',
    });

    api = new FakeTeamsApi();
    dispatcher = new WebhookDispatcher();
    dispatcher.registerSink(new TeamsEventSink());
    claims = new ConversationClaimsService(dispatcher);
    conv = new ConvService(
      dispatcher,
      claims,
      new CuratorJobsService(dispatcher),
      new AlertsService(dispatcher),
      stubAttachmentGateway(),
    );
  });

  function run<T>(fn: () => Promise<T>, runAs: ActorIdentity = actor): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${runAs.orgId}, true)`);
      await tx.execute(sql`SELECT set_config('app.crypt_key', ${process.env.MUNIN_ENCRYPTION_KEY ?? ''}, true)`);
      const ctx: RequestContext = { db: tx, actor: runAs, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }

  function service(): TeamsService {
    const registry = new CredentialTargetRegistry();
    const teams = new TeamsService(db, api, new CredentialHandoffService(db, registry));
    registry.register(teams);
    return teams;
  }

  async function seedConversation(): Promise<string> {
    displayIdSeq += 1;
    const [conversation] = await db
      .insert(schema.convConversations)
      .values({ orgId, displayId: displayIdSeq, channelId: convChannelId, contactId, subject: 'Missing parcel' })
      .returning();
    return conversation!.id;
  }

  async function seedMessage(conversationId: string, body: string): Promise<string> {
    const [message] = await db
      .insert(schema.convMessages)
      .values({ orgId, conversationId, authorType: 'end_user', authorId: contactId, body })
      .returning();
    return message!.id;
  }

  async function enqueue(eventType: string, conversationId: string, payload: Record<string, unknown>) {
    const [event] = await db.insert(schema.events).values({ orgId, type: eventType, payload }).returning();
    const [delivery] = await db
      .insert(schema.teamsDeliveries)
      .values({ orgId, integrationId, eventId: event!.id, eventType, conversationId, nextAttemptAt: new Date() })
      .returning();
    return delivery!;
  }

  async function mirrored(conversationId: string) {
    const worker = new TeamsBridgeWorker(db, api);
    await enqueue('conversation.created', conversationId, { conversationId });
    await worker.tick();
    const [link] = await db
      .select()
      .from(schema.teamsConversationLinks)
      .where(eq(schema.teamsConversationLinks.conversationId, conversationId));
    return link!;
  }

  function activity(overrides: Partial<TeamsInboundActivity> = {}): TeamsInboundActivity {
    return {
      type: 'message',
      id: `17500000000${Math.floor(Math.random() * 1000)}`,
      serviceUrl: SERVICE_URL,
      from: { id: '29:operator', name: 'Kari Nordmann', aadObjectId: 'ffffffff-0000-0000-0000-000000000001' },
      recipient: { id: BOT_ID, name: 'Munin' },
      conversation: { id: CHANNEL_ID, conversationType: 'channel', tenantId: TENANT_ID },
      channelData: { tenant: { id: TENANT_ID }, team: { id: TEAM_ID }, channel: { id: CHANNEL_ID } },
      ...overrides,
    };
  }

  function inbound(): TeamsInboundService {
    return new TeamsInboundService(db, api, conv, new TeamsUserMappingService(db, api));
  }

  function interactions(): TeamsInteractionsService {
    return new TeamsInteractionsService(db, conv, claims, new TeamsUserMappingService(db, api));
  }

  async function integration() {
    const [row] = await db
      .select()
      .from(schema.teamsIntegrations)
      .where(eq(schema.teamsIntegrations.id, integrationId));
    return row!;
  }

  describe('outbound mirroring', () => {
    it('posts one root card per conversation and mirrors messages into its thread', async () => {
      const conversationId = await seedConversation();
      const messageId = await seedMessage(conversationId, 'Where is my parcel?');
      await enqueue('conversation.created', conversationId, { conversationId });
      await enqueue('conversation.message.received', conversationId, { conversationId, messageId });

      const result = await new TeamsBridgeWorker(db, api).tick();
      expect(result).toEqual({ attempted: 2, delivered: 2, failed: 0 });

      expect(api.threads).toHaveLength(1);
      const root = api.threads[0]!;
      expect(root.channelId).toBe(CHANNEL_ID);
      expect(root.activity.summary).toContain('Missing parcel');
      expect(cardVerbs(root.activity)).toEqual(['munin_claim', 'munin_close', undefined]);

      expect(api.sent).toHaveLength(1);
      expect(api.sent[0]!.conversationId).toBe(`${CHANNEL_ID};messageid=${root.activityId}`);
      expect(api.sent[0]!.activity.text).toContain('<b>Ola Nordmann</b> (customer)');
      expect(api.sent[0]!.activity.text).toContain('Where is my parcel?');

      const [messageLink] = await db
        .select()
        .from(schema.teamsMessageLinks)
        .where(eq(schema.teamsMessageLinks.messageId, messageId));
      expect(messageLink).toMatchObject({ origin: 'mirrored', activityId: api.sent[0]!.activityId });
    });

    it('refreshes the root card and posts a thread note when the status changes', async () => {
      const conversationId = await seedConversation();
      const link = await mirrored(conversationId);
      await db
        .update(schema.convConversations)
        .set({ status: 'closed' })
        .where(eq(schema.convConversations.id, conversationId));
      await enqueue('conversation.status_changed', conversationId, { conversationId, status: 'closed' });

      await new TeamsBridgeWorker(db, api).tick();

      expect(api.updates).toHaveLength(1);
      expect(api.updates[0]!.activityId).toBe(link.rootActivityId);
      expect(cardVerbs(api.updates[0]!.activity)).toEqual(['munin_reopen', undefined]);
      expect(api.sent.at(-1)!.activity.text).toContain('Conversation is resolved');
    });

    it('raises handover alerts in the escalations channel as well as the thread', async () => {
      await db.insert(schema.teamsChannelRoutes).values({
        orgId,
        integrationId,
        installedTeamId,
        teamsChannelId: ESCALATION_CHANNEL_ID,
        purpose: 'escalations',
      });
      const conversationId = await seedConversation();
      await mirrored(conversationId);
      await enqueue('conversation.handover_requested', conversationId, {
        conversationId,
        reason: 'Customer asked for a person',
      });

      await new TeamsBridgeWorker(db, api).tick();

      const alert = api.threads.find((t) => t.channelId === ESCALATION_CHANNEL_ID);
      expect(alert?.activity.text).toContain('Human attention needed');
      expect(alert?.activity.text).toContain('Customer asked for a person');
      expect(api.sent.at(-1)!.activity.text).toContain('Human attention requested');
    });

    it('defers a throttled delivery without spending an attempt', async () => {
      const conversationId = await seedConversation();
      const delivery = await enqueue('conversation.created', conversationId, { conversationId });
      api.sendError = new TeamsApiError(429, 'http_429', 5_000);

      await new TeamsBridgeWorker(db, api).tick();

      const [row] = await db
        .select()
        .from(schema.teamsDeliveries)
        .where(eq(schema.teamsDeliveries.id, delivery.id));
      expect(row!.attempt).toBe(0);
      expect(row!.deliveredAt).toBeNull();
      expect(row!.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 3_000);
    });

    it('gives up at once when Teams blocks the bot from posting', async () => {
      const conversationId = await seedConversation();
      const delivery = await enqueue('conversation.created', conversationId, { conversationId });
      api.sendError = new TeamsApiError(403, 'MessageWritesBlocked');

      await new TeamsBridgeWorker(db, api).tick();

      const [row] = await db
        .select()
        .from(schema.teamsDeliveries)
        .where(eq(schema.teamsDeliveries.id, delivery.id));
      expect(row!.deliveredAt).not.toBeNull();
      expect(row!.error).toContain('MessageWritesBlocked');
    });

    it('fails a delivery terminally when the routed team no longer has the bot installed', async () => {
      await db
        .update(schema.teamsInstalledTeams)
        .set({ installed: false })
        .where(eq(schema.teamsInstalledTeams.id, installedTeamId));
      const conversationId = await seedConversation();
      const delivery = await enqueue('conversation.created', conversationId, { conversationId });

      await new TeamsBridgeWorker(db, api).tick();

      const [row] = await db
        .select()
        .from(schema.teamsDeliveries)
        .where(eq(schema.teamsDeliveries.id, delivery.id));
      expect(row!.error).toBe('bot_not_installed');
      expect(api.threads).toHaveLength(0);
    });

    it('queues nothing until the bot secret has been entered', async () => {
      await db
        .update(schema.teamsIntegrations)
        .set({ encryptedAppSecret: null })
        .where(eq(schema.teamsIntegrations.id, integrationId));
      const conversationId = await seedConversation();
      await run(() => conv.sendMessage({ conversationId, body: 'Internal check', internal: true, authorType: 'user', authorId: memberUserId, claim: false }));
      const rows = await db
        .select()
        .from(schema.teamsDeliveries)
        .where(eq(schema.teamsDeliveries.integrationId, integrationId));
      expect(rows).toHaveLength(0);
    });
  });

  describe('inbound activities', () => {
    it('sends a thread reply to the customer as the matched member and never re-mirrors it', async () => {
      const conversationId = await seedConversation();
      const link = await mirrored(conversationId);
      api.members.set('29:operator', {
        aadObjectId: 'ffffffff-0000-0000-0000-000000000001',
        email: null,
        userPrincipalName: memberEmail.toUpperCase(),
      });

      await inbound().processActivity(
        await integration(),
        activity({
          text: '<p><at>Munin</at> Your parcel is <strong>on its way</strong></p>',
          conversation: { id: `${CHANNEL_ID};messageid=${link.rootActivityId}`, tenantId: TENANT_ID },
        }),
      );

      const messages = await db
        .select()
        .from(schema.convMessages)
        .where(eq(schema.convMessages.conversationId, conversationId));
      const reply = messages.find((m) => m.authorType === 'user');
      expect(reply).toMatchObject({ authorId: memberUserId, body: 'Your parcel is **on its way**', internal: false });

      const [userLink] = await db
        .select()
        .from(schema.teamsUserLinks)
        .where(eq(schema.teamsUserLinks.integrationId, integrationId));
      expect(userLink?.userId).toBe(memberUserId);

      const sentBefore = api.sent.length;
      await new TeamsBridgeWorker(db, api).tick();
      expect(api.sent.length).toBe(sentBefore);
      const [echo] = await db
        .select()
        .from(schema.teamsDeliveries)
        .where(
          and(
            eq(schema.teamsDeliveries.conversationId, conversationId),
            eq(schema.teamsDeliveries.eventType, 'conversation.message.sent'),
          ),
        );
      expect(echo?.deliveredAt).not.toBeNull();
      expect(echo?.error).toBeNull();
    });

    it('records a !-prefixed reply as an internal note', async () => {
      const conversationId = await seedConversation();
      const link = await mirrored(conversationId);
      api.members.set('29:operator', { email: memberEmail });

      await inbound().processActivity(
        await integration(),
        activity({
          text: '<p>! checking with the warehouse</p>',
          conversation: { id: `${CHANNEL_ID};messageid=${link.rootActivityId}` },
        }),
      );

      const [note] = await db
        .select()
        .from(schema.convMessages)
        .where(and(eq(schema.convMessages.conversationId, conversationId), eq(schema.convMessages.authorType, 'user')));
      expect(note).toMatchObject({ internal: true, body: 'checking with the warehouse' });
    });

    it('tells an unlinked sender their reply was not sent', async () => {
      const conversationId = await seedConversation();
      const link = await mirrored(conversationId);
      api.members.set('29:operator', { email: 'stranger@example.com' });

      await inbound().processActivity(
        await integration(),
        activity({ text: 'Hello', conversation: { id: `${CHANNEL_ID};messageid=${link.rootActivityId}` } }),
      );

      const replies = await db
        .select()
        .from(schema.convMessages)
        .where(and(eq(schema.convMessages.conversationId, conversationId), eq(schema.convMessages.authorType, 'user')));
      expect(replies).toHaveLength(0);
      const notice = api.sent.at(-1)!;
      expect(notice.activity.text).toContain('<at>Kari Nordmann</at>');
      expect(notice.activity.text).toContain('not sent to the customer');
    });

    it('ignores activities from another tenant', async () => {
      const conversationId = await seedConversation();
      const link = await mirrored(conversationId);
      api.members.set('29:operator', { email: memberEmail });

      await inbound().processActivity(
        await integration(),
        activity({
          text: 'Hello',
          conversation: { id: `${CHANNEL_ID};messageid=${link.rootActivityId}` },
          channelData: { tenant: { id: '00000000-0000-0000-0000-00000000dead' } },
        }),
      );

      const replies = await db
        .select()
        .from(schema.convMessages)
        .where(and(eq(schema.convMessages.conversationId, conversationId), eq(schema.convMessages.authorType, 'user')));
      expect(replies).toHaveLength(0);
    });

    it('records the team when the bot is installed and marks it removed on uninstall', async () => {
      const newTeam = '19:new-team@thread.tacv2';
      const service = inbound();
      await service.processActivity(
        await integration(),
        activity({
          type: 'conversationUpdate',
          membersAdded: [{ id: BOT_ID }],
          channelData: { eventType: 'teamMemberAdded', tenant: { id: TENANT_ID }, team: { id: newTeam, name: 'Returns' } },
          conversation: { id: newTeam },
        }),
      );
      let [team] = await db
        .select()
        .from(schema.teamsInstalledTeams)
        .where(and(eq(schema.teamsInstalledTeams.integrationId, integrationId), eq(schema.teamsInstalledTeams.teamId, newTeam)));
      expect(team).toMatchObject({ teamName: 'Returns', installed: true, serviceUrl: SERVICE_URL });

      await service.processActivity(
        await integration(),
        activity({
          type: 'installationUpdate',
          action: 'remove',
          channelData: { tenant: { id: TENANT_ID }, team: { id: newTeam } },
          conversation: { id: newTeam },
        }),
      );
      [team] = await db
        .select()
        .from(schema.teamsInstalledTeams)
        .where(and(eq(schema.teamsInstalledTeams.integrationId, integrationId), eq(schema.teamsInstalledTeams.teamId, newTeam)));
      expect(team?.installed).toBe(false);
    });

    it('forgets the thread link when the root post is deleted in Teams', async () => {
      const conversationId = await seedConversation();
      const link = await mirrored(conversationId);

      await inbound().processActivity(
        await integration(),
        activity({ type: 'messageDelete', id: link.rootActivityId, conversation: { id: `${CHANNEL_ID};messageid=${link.rootActivityId}` } }),
      );

      const links = await db
        .select()
        .from(schema.teamsConversationLinks)
        .where(eq(schema.teamsConversationLinks.conversationId, conversationId));
      expect(links).toHaveLength(0);
    });
  });

  describe('card actions', () => {
    function invoke(conversationId: string, verb: string, rootActivityId: string): TeamsInboundActivity {
      return activity({
        type: 'invoke',
        name: 'adaptiveCard/action',
        conversation: { id: `${CHANNEL_ID};messageid=${rootActivityId}` },
        value: { action: { type: 'Action.Execute', verb, data: { conversationId } } },
      });
    }

    it('takes over the conversation as the clicking member and returns the refreshed card', async () => {
      const conversationId = await seedConversation();
      const link = await mirrored(conversationId);
      api.members.set('29:operator', { email: memberEmail });

      const response = await interactions().handleInvoke(await integration(), invoke(conversationId, 'munin_claim', link.rootActivityId));

      expect(response.status).toBe(200);
      expect(response.body.type).toBe('application/vnd.microsoft.card.adaptive');
      const card = response.body.value as { actions: Array<{ verb?: string }> };
      expect(card.actions.map((a) => a.verb)).toEqual(['munin_release', 'munin_close', undefined]);
      const [claim] = await db
        .select()
        .from(schema.claims)
        .where(and(eq(schema.claims.entityType, 'conversation'), eq(schema.claims.entityId, conversationId)));
      expect(claim?.userId).toBe(memberUserId);
    });

    it('closes the conversation from the card', async () => {
      const conversationId = await seedConversation();
      const link = await mirrored(conversationId);
      api.members.set('29:operator', { email: memberEmail });

      await interactions().handleInvoke(await integration(), invoke(conversationId, 'munin_close', link.rootActivityId));

      const [row] = await db
        .select({ status: schema.convConversations.status })
        .from(schema.convConversations)
        .where(eq(schema.convConversations.id, conversationId));
      expect(row?.status).toBe('closed');
    });

    it('refuses an unlinked clicker with a message instead of acting', async () => {
      const conversationId = await seedConversation();
      const link = await mirrored(conversationId);

      const response = await interactions().handleInvoke(await integration(), invoke(conversationId, 'munin_close', link.rootActivityId));

      expect(response.body.type).toBe('application/vnd.microsoft.activity.message');
      expect(String(response.body.value)).toContain('linked Munin account');
      const [row] = await db
        .select({ status: schema.convConversations.status })
        .from(schema.convConversations)
        .where(eq(schema.convConversations.id, conversationId));
      expect(row?.status).toBe('open');
    });

    it('refuses an action posted from a different channel than the thread', async () => {
      const conversationId = await seedConversation();
      await mirrored(conversationId);
      api.members.set('29:operator', { email: memberEmail });

      const response = await interactions().handleInvoke(
        await integration(),
        activity({
          type: 'invoke',
          name: 'adaptiveCard/action',
          conversation: { id: `${ESCALATION_CHANNEL_ID};messageid=1` },
          value: { action: { verb: 'munin_close', data: { conversationId } } },
        }),
      );
      expect(String(response.body.value)).toContain('no longer mirrored here');
    });

    it('rejects unknown verbs', async () => {
      const response = await interactions().handleInvoke(await integration(), invoke('cnv_x', 'drop_tables', '1'));
      expect(String(response.body.value)).toContain('not supported');
    });
  });

  describe('admin service', () => {
    it('refuses a second connection for the same org', async () => {
      await expect(
        run(() => service().createConnection({ appId: randomUUID(), tenantId: TENANT_ID })),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses an app id already connected to another org', async () => {
      const other = new ActorIdentity('admin_agent', 'agt_other', otherOrgId, ['*'], ['admin']);
      await expect(
        run(() => service().createConnection({ appId, tenantId: TENANT_ID }), other),
      ).rejects.toThrow(/different Munin org/);
    });

    it('creates a pending connection and returns a credentials link', async () => {
      const other = new ActorIdentity('admin_agent', 'agt_other', otherOrgId, ['*'], ['admin']);
      const newAppId = randomUUID().toUpperCase();
      const result = await run(() => service().createConnection({ appId: newAppId, tenantId: TENANT_ID }), other);
      expect(result.integration).toMatchObject({ appId: newAppId.toLowerCase(), credentialState: 'pending' });
      expect(result.credentials?.url).toContain('/connect/credentials?token=mncl_');
      expect(result.messagingEndpoint).toMatch(/\/v1\/teams\/messages$/);
    });

    it('connects in one step when the client secret comes with the ids', async () => {
      const other = new ActorIdentity('admin_agent', 'agt_other', otherOrgId, ['*'], ['admin']);
      const result = await run(
        () => service().createConnection({ appId: randomUUID(), tenantId: TENANT_ID, appSecret: 'right-secret' }),
        other,
      );
      expect(result.credentials).toBeNull();
      expect(result.integration.credentialState).toBe('active');
      const status = await run(() => service().status(), other);
      expect(status.connected).toBe(true);
    });

    it('saves nothing when Microsoft rejects the client secret given with the ids', async () => {
      const other = new ActorIdentity('admin_agent', 'agt_other', otherOrgId, ['*'], ['admin']);
      api.tokenError = new TeamsApiError(401, 'invalid_client');
      await expect(
        run(
          () => service().createConnection({ appId: randomUUID(), tenantId: TENANT_ID, appSecret: 'wrong-secret' }),
          other,
        ),
      ).rejects.toThrow(/teams_invalid_credentials: .*invalid_client/);
      api.tokenError = null;
      const status = await run(() => service().status(), other);
      expect(status.integration).toBeNull();
    });

    it('stores and verifies the client secret through the credential handoff', async () => {
      const other = new ActorIdentity('admin_agent', 'agt_other', otherOrgId, ['*'], ['admin']);
      const registry = new CredentialTargetRegistry();
      const handoff = new CredentialHandoffService(db, registry);
      const teams = new TeamsService(db, api, handoff);
      registry.register(teams);
      const created = await run(() => teams.createConnection({ appId: randomUUID(), tenantId: TENANT_ID }), other);
      const token = new URL(created.credentials!.url).searchParams.get('token')!;

      const described = await handoff.describe(token);
      expect(described.fields.map((f) => f.key)).toEqual(['appSecret']);

      api.tokenError = new TeamsApiError(401, 'invalid_client');
      const rejected = await handoff.complete(token, { appSecret: 'wrong-secret' });
      expect(rejected).toMatchObject({ ok: false });
      expect(rejected.error).toContain('invalid_client');

      api.tokenError = null;
      const fresh = await run(() => teams.requestCredentials(), other);
      const accepted = await handoff.complete(new URL(fresh.url).searchParams.get('token')!, {
        appSecret: 'right-secret',
      });
      expect(accepted).toEqual({ ok: true, detail: 'credentials saved and verified' });
      const status = await run(() => teams.status(), other);
      expect(status.integration?.credentialState).toBe('active');
      expect(status.connected).toBe(true);
    });

    it('routes a channel found in an installed team and rejects unknown channels', async () => {
      const route = await run(() =>
        service().setRouting({ teamsChannelId: ESCALATION_CHANNEL_ID, purpose: 'escalations' }),
      );
      expect(route).toMatchObject({ teamsChannelId: ESCALATION_CHANNEL_ID, teamsChannelName: 'Escalations', teamId: TEAM_ID });

      await expect(
        run(() => service().setRouting({ teamsChannelId: '19:nowhere@thread.tacv2' })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to reuse a routed channel for another purpose', async () => {
      await expect(
        run(() => service().setRouting({ teamsChannelId: CHANNEL_ID, purpose: 'escalations' })),
      ).rejects.toThrow(/already used by this org's 'default' route/);
    });

    it('refuses to scope a non-default route to a source channel', async () => {
      await expect(
        run(() =>
          service().setRouting({ teamsChannelId: ESCALATION_CHANNEL_ID, purpose: 'escalations', convChannelId }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('posts a test message to the default channel', async () => {
      const result = await run(() => service().sendTest());
      expect(result).toMatchObject({ ok: true, teamsChannelId: CHANNEL_ID });
      expect(api.threads[0]!.activity.text).toContain('Munin is connected');
    });

    it('links and unlinks users, refusing non-members', async () => {
      const aadObjectId = 'ffffffff-0000-0000-0000-000000000002';
      const linked = await run(() => service().linkUser({ aadObjectId, userId: memberUserId }));
      expect(linked).toMatchObject({ aadObjectId, userId: memberUserId, userEmail: memberEmail });
      await expect(run(() => service().listUserLinks())).resolves.toHaveLength(1);

      await expect(
        run(() => service().linkUser({ aadObjectId, userId: 'usr_not_a_member' })),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(run(() => service().unlinkUser({ aadObjectId }))).resolves.toEqual({ unlinked: true, aadObjectId });
      await expect(run(() => service().unlinkUser({ aadObjectId }))).rejects.toBeInstanceOf(NotFoundException);
    });

    it('disconnects and cascades routes and installed teams', async () => {
      await expect(run(() => service().disconnect())).resolves.toMatchObject({ disconnected: true, id: integrationId });
      const teams = await db
        .select()
        .from(schema.teamsInstalledTeams)
        .where(eq(schema.teamsInstalledTeams.integrationId, integrationId));
      expect(teams).toHaveLength(0);
      await expect(run(() => service().disconnect())).rejects.toBeInstanceOf(NotFoundException);
    });

    it('builds the app package for the connected bot', async () => {
      const pkg = await run(() => service().appPackage());
      expect(pkg.filename).toBe('munin-teams-app.zip');
      expect(pkg.data.subarray(0, 2).toString('ascii')).toBe('PK');
      expect(pkg.data.includes(Buffer.from(appId))).toBe(true);
    });
  });
});
