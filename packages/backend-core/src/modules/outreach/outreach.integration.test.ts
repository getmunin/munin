import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { AppModule } from '../../app.module.ts';
import { INSPECTOR_APP_URI } from '../../mcp/inspector.resource.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run Outreach integration tests.';

(skipReason ? describe.skip : describe)('Outreach integration: admin tools via /mcp', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let adminKey: string;
  let channelId: string;
  let segmentId: string;
  let contactId: string;
  let conversationId: string;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Outreach IT Org' })
      .returning();
    orgId = org!.id;

    adminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'outreach-it-admin',
      keyHash: hashSecret(adminKey),
      keyPrefix: keyPrefix(adminKey),
      scopes: ['*'],
    });

    const [ch] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'email',
        vendor: 'smtp',
        name: 'support',
        active: true,
        config: { addressing: { fromAddress: 'support@example.com' } },
      })
      .returning();
    channelId = ch!.id;

    const [seg] = await db
      .insert(schema.crmSegments)
      .values({
        orgId,
        name: 'priority-prospects',
        description: null,
        filterDefinition: { tagsAny: ['priority'] },
        createdByActorType: 'admin_agent',
        createdByActorId: 'outreach-it-setup',
      })
      .returning();
    segmentId = seg!.id;

    const [contact] = await db
      .insert(schema.crmContacts)
      .values({
        orgId,
        name: 'Jane Doe',
        email: 'jane@acme.com',
        consentLawfulBasis: 'legitimate_interest',
        consentGivenAt: new Date(),
        consentSource: 'imported-test',
        tags: ['priority'],
      })
      .returning();
    contactId = contact!.id;

    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  async function withClient<T>(token: string, fn: (c: Client) => Promise<T>): Promise<T> {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const c = new Client({ name: 'outreach-it', version: '0.0.0' });
    await c.connect(transport);
    try {
      return await fn(c);
    } finally {
      await transport.close();
      await c.close();
    }
  }

  function firstJson(result: { content: Array<{ type: string; text?: string }> }): unknown {
    for (const item of result.content) {
      if (item.type === 'text' && typeof item.text === 'string') {
        try {
          return JSON.parse(item.text);
        } catch {
          return item.text;
        }
      }
    }
    return null;
  }

  it('discovers all 11 outreach tools on tools/list', async () => {
    await withClient(adminKey, async (c) => {
      const { tools } = await c.listTools();
      const names = tools.map((t) => t.name).filter((n) => n.startsWith('outreach_')).sort();
      expect(names).toEqual(
        [
          'outreach_approve_proposal',
          'outreach_create_campaign',
          'outreach_dismiss_proposal',
          'outreach_export',
          'outreach_get_campaign',
          'outreach_import',
          'outreach_list_campaigns',
          'outreach_list_proposals',
          'outreach_propose_initial',
          'outreach_propose_reply',
          'outreach_update_campaign',
        ].sort(),
      );

      const listProposals = tools.find((t) => t.name === 'outreach_list_proposals');
      expect(
        (listProposals as { _meta?: { ui?: { resourceUri?: string } } })._meta?.ui?.resourceUri,
      ).toBe(INSPECTOR_APP_URI);
      expect(INSPECTOR_APP_URI).toMatch(/^ui:\/\/munin\/inspector@[0-9a-f]{8}$/);
    });
  });

  it('full admin flow: list (empty) → create → get → update → list (1) → propose_initial → list_proposals', async () => {
    let campaignId = '';
    let proposalId = '';

    await withClient(adminKey, async (c) => {
      const empty = await c.callTool({ name: 'outreach_list_campaigns', arguments: {} });
      const emptyList = firstJson(empty as never) as unknown[];
      expect(Array.isArray(emptyList)).toBe(true);
      expect(emptyList).toHaveLength(0);

      const created = await c.callTool({
        name: 'outreach_create_campaign',
        arguments: {
          name: 'Q2 outreach',
          brief: 'Re-engage prospects who showed interest last quarter.',
          segmentId,
          channelId,
        },
      });
      const campaign = firstJson(created as never) as { id: string; name: string; enabled: boolean };
      expect(campaign.id).toMatch(/^ocmp_/);
      expect(campaign.name).toBe('Q2 outreach');
      expect(campaign.enabled).toBe(false);
      campaignId = campaign.id;

      const got = await c.callTool({
        name: 'outreach_get_campaign',
        arguments: { id: campaignId },
      });
      const gotCampaign = firstJson(got as never) as { id: string; brief: string };
      expect(gotCampaign.id).toBe(campaignId);
      expect(gotCampaign.brief).toContain('Re-engage');

      const updated = await c.callTool({
        name: 'outreach_update_campaign',
        arguments: { id: campaignId, patch: { enabled: true } },
      });
      const updatedCampaign = firstJson(updated as never) as { enabled: boolean };
      expect(updatedCampaign.enabled).toBe(true);

      const populated = await c.callTool({ name: 'outreach_list_campaigns', arguments: {} });
      const populatedList = firstJson(populated as never) as Array<{ id: string }>;
      expect(populatedList.map((r) => r.id)).toContain(campaignId);

      const proposed = await c.callTool({
        name: 'outreach_propose_initial',
        arguments: {
          campaignId,
          contactId,
          draftSubject: 'Hi Jane',
          draftBody: 'We just shipped X — would you like a quick demo?',
        },
      });
      const proposal = firstJson(proposed as never) as { id: string; status: string; kind: string };
      expect(proposal.id).toMatch(/^oprp_/);
      expect(proposal.status).toBe('pending');
      expect(proposal.kind).toBe('initial');
      proposalId = proposal.id;

      const listed = await c.callTool({
        name: 'outreach_list_proposals',
        arguments: { status: 'pending' },
      });
      const proposals = firstJson(listed as never) as Array<{
        id: string;
        contact?: { email?: string };
      }>;
      expect(proposals.map((p) => p.id)).toContain(proposalId);
      const ours = proposals.find((p) => p.id === proposalId);
      expect(ours?.contact?.email).toBe('jane@acme.com');
    });
  });

  it('propose_reply requires a conversation with outreachCampaignId set', async () => {
    const [convContact] = await db
      .insert(schema.convContacts)
      .values({
        orgId,
        email: 'jane@acme.com',
        name: 'Jane Doe',
      })
      .returning();
    const nextDisplay = await db.execute<{ next: number }>(
      sql`SELECT conv_next_display_id(${orgId}) AS next`,
    );
    const [conv] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        channelId,
        contactId: convContact!.id,
        displayId: nextDisplay[0]!.next,
        status: 'open',
        outreachCampaignId: null,
      })
      .returning();
    conversationId = conv!.id;

    await withClient(adminKey, async (c) => {
      const noCampaign = await c.callTool({
        name: 'outreach_propose_reply',
        arguments: {
          conversationId,
          draftBody: 'Thanks for replying!',
        },
      });
      expect(noCampaign.isError).toBe(true);
    });

    const [outreachCampaign] = await db
      .insert(schema.outreachCampaigns)
      .values({
        orgId,
        name: 'reply-flow',
        brief: 'Reply flow test',
        segmentId,
        channelId,
        enabled: true,
        unsubscribeRequired: true,
        createdByActorType: 'admin_agent',
        createdByActorId: 'outreach-it-setup',
      })
      .returning();
    await db
      .update(schema.convConversations)
      .set({ outreachCampaignId: outreachCampaign!.id })
      .where(sql`id = ${conversationId}`);

    await withClient(adminKey, async (c) => {
      const proposed = await c.callTool({
        name: 'outreach_propose_reply',
        arguments: {
          conversationId,
          draftBody: 'Following up with a tailored offer.',
        },
      });
      const raw = JSON.stringify(proposed);
      const proposal = firstJson(proposed as never) as
        | { id: string; kind?: string; status?: string }
        | null;
      expect(proposed.isError, `expected success, got: ${raw}`).not.toBe(true);
      expect(proposal?.kind).toBe('reply');
      expect(proposal?.status).toBe('pending');
    });
  });

  it('automation flags default to autoDraftInitial=false / autoDraftReplies=true and are togglable', async () => {
    await withClient(adminKey, async (c) => {
      const created = firstJson(
        (await c.callTool({
          name: 'outreach_create_campaign',
          arguments: {
            name: 'flag-defaults',
            brief: 'Check automation flag defaults.',
            segmentId,
            channelId,
          },
        })) as never,
      ) as { id: string; autoDraftInitial: boolean; autoDraftReplies: boolean };
      expect(created.autoDraftInitial).toBe(false);
      expect(created.autoDraftReplies).toBe(true);

      const updated = firstJson(
        (await c.callTool({
          name: 'outreach_update_campaign',
          arguments: { id: created.id, patch: { autoDraftInitial: true, autoDraftReplies: false } },
        })) as never,
      ) as { autoDraftInitial: boolean; autoDraftReplies: boolean };
      expect(updated.autoDraftInitial).toBe(true);
      expect(updated.autoDraftReplies).toBe(false);
    });
  });

  it('propose_initial refuses a contact already sent a first-touch, but allows re-draft after dismissal', async () => {
    let campaignId = '';
    let firstProposalId = '';

    await withClient(adminKey, async (c) => {
      const created = firstJson(
        (await c.callTool({
          name: 'outreach_create_campaign',
          arguments: {
            name: 'recontact-guard',
            brief: 'Guard against re-contacting the same person.',
            segmentId,
            channelId,
          },
        })) as never,
      ) as { id: string };
      campaignId = created.id;

      const first = firstJson(
        (await c.callTool({
          name: 'outreach_propose_initial',
          arguments: { campaignId, contactId, draftSubject: 'Hi Jane', draftBody: 'First touch.' },
        })) as never,
      ) as { id: string };
      firstProposalId = first.id;
    });

    await db
      .update(schema.outreachProposals)
      .set({ status: 'sent' })
      .where(sql`id = ${firstProposalId}`);

    await withClient(adminKey, async (c) => {
      const blocked = await c.callTool({
        name: 'outreach_propose_initial',
        arguments: { campaignId, contactId, draftSubject: 'Hi again', draftBody: 'Second touch.' },
      });
      expect(blocked.isError).toBe(true);
      expect(JSON.stringify(blocked)).toContain('outreach_conflict');
    });

    await db
      .update(schema.outreachProposals)
      .set({ status: 'dismissed' })
      .where(sql`id = ${firstProposalId}`);

    await withClient(adminKey, async (c) => {
      const allowed = await c.callTool({
        name: 'outreach_propose_initial',
        arguments: { campaignId, contactId, draftSubject: 'Hi again', draftBody: 'Second touch.' },
      });
      expect(allowed.isError).not.toBe(true);
      const proposal = firstJson(allowed as never) as { status: string };
      expect(proposal.status).toBe('pending');
    });
  });

  it('dismiss_proposal decides a pending proposal; approve/dismiss refuse non-pending and unknown ids', async () => {
    await withClient(adminKey, async (c) => {
      const created = firstJson(
        (await c.callTool({
          name: 'outreach_create_campaign',
          arguments: {
            name: 'panel-review',
            brief: 'Exercise the proposal review decision tools.',
            segmentId,
            channelId,
          },
        })) as never,
      ) as { id: string };

      const proposed = firstJson(
        (await c.callTool({
          name: 'outreach_propose_initial',
          arguments: {
            campaignId: created.id,
            contactId,
            draftSubject: 'Hi Jane',
            draftBody: 'Reviewed in the panel.',
          },
        })) as never,
      ) as { id: string };

      const dismissed = await c.callTool({
        name: 'outreach_dismiss_proposal',
        arguments: { id: proposed.id, reason: 'not a fit' },
      });
      expect(dismissed.isError).not.toBe(true);
      const dto = firstJson(dismissed as never) as {
        status: string;
        dismissReason: string | null;
        decidedByActorType: string | null;
      };
      expect(dto.status).toBe('dismissed');
      expect(dto.dismissReason).toBe('not a fit');
      expect(dto.decidedByActorType).toBe('admin_agent');

      const approveAfter = await c.callTool({
        name: 'outreach_approve_proposal',
        arguments: { id: proposed.id },
      });
      expect(approveAfter.isError).toBe(true);
      expect(JSON.stringify(approveAfter)).toContain('not pending');

      const dismissAgain = await c.callTool({
        name: 'outreach_dismiss_proposal',
        arguments: { id: proposed.id },
      });
      expect(dismissAgain.isError).toBe(true);
      expect(JSON.stringify(dismissAgain)).toContain('not pending');

      const missing = await c.callTool({
        name: 'outreach_approve_proposal',
        arguments: { id: 'op_doesnotexist' },
      });
      expect(missing.isError).toBe(true);
    });
  });

  it('create_campaign rejects a non-email channel', async () => {
    const [chatCh] = await db
      .insert(schema.convChannels)
      .values({
        orgId,
        type: 'chat',
        vendor: 'munin',
        name: 'web-widget-reject',
        active: true,
        config: {},
      })
      .returning();

    await withClient(adminKey, async (c) => {
      const result = await c.callTool({
        name: 'outreach_create_campaign',
        arguments: {
          name: 'wrong-channel',
          brief: 'Should fail',
          segmentId,
          channelId: chatCh!.id,
        },
      });
      expect(result.isError).toBe(true);
    });
  });
});
