import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { createDb, runMigrations, schema } from '@munin/db';
import { sql } from 'drizzle-orm';
import { createApp } from '../bootstrap-app.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run multi-user tests.';

interface SignupResp {
  user: { id: string; email: string };
  token?: string;
  session?: { token: string };
}

(skipReason ? describe.skip : describe)('Multi-user org: auto-provision + invite + accept', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  const orgIdsToCleanup: string[] = [];
  const userIdsToCleanup: string[] = [];

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED = '1';
    process.env.MUNIN_STORAGE_PROVIDER = 'local';
    process.env.MUNIN_STORAGE_LOCAL_PATH = '/tmp/munin-multiuser-test';
    process.env.MUNIN_STORAGE_LOCAL_BASE_URL = 'http://127.0.0.1:0/static/assets';

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    app = await createApp({ logger: false });
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
      for (const orgId of orgIdsToCleanup) {
        await db.delete(schema.orgs).where(sql`id = ${orgId}`);
      }
      for (const userId of userIdsToCleanup) {
        await db.delete(schema.users).where(sql`id = ${userId}`);
      }
    }
  });

  /** Sign up via BetterAuth. Returns the session cookie + user id. */
  async function signup(email: string, password: string): Promise<{ cookie: string; userId: string }> {
    const res = await fetch(`${baseUrl}/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name: email.split('@')[0] }),
    });
    const text = await res.text();
    if (res.status >= 400) {
      throw new Error(`signup failed: ${res.status} ${text}`);
    }
    const body = JSON.parse(text) as SignupResp;
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('better-auth.session_token');
    return { cookie, userId: body.user.id };
  }

  function extractSessionCookie(setCookieHeader: string): string {
    // Pull the first cookie name=value pair before any attributes (Path/HttpOnly/...).
    const match = setCookieHeader.match(/(better-auth\.session_token=[^;]+)/);
    if (!match) throw new Error('session cookie not found');
    return match[1]!;
  }

  it('signup auto-provisions a personal org and a session-cookie request resolves to it', async () => {
    const ts = Date.now();
    const email = `solo-${ts}@example.com`;
    const { cookie, userId } = await signup(email, 'verystrongpassword123');
    userIdsToCleanup.push(userId);

    const memberships = await db
      .select()
      .from(schema.orgMembers)
      .where(sql`user_id = ${userId}`);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]!.role).toBe('owner');
    orgIdsToCleanup.push(memberships[0]!.orgId);

    const me = await fetch(`${baseUrl}/api/orgs/me`, {
      headers: { Cookie: extractSessionCookie(cookie) },
    });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { id: string; slug: string };
    expect(meBody.id).toBe(memberships[0]!.orgId);
  }, 30_000);

  it('owner invites a new email; the invitee signs up separately, accepts, and joins', async () => {
    const ts = Date.now();
    const inviterEmail = `inviter-${ts}@example.com`;
    const inviteeEmail = `invitee-${ts}@example.com`;
    const inviter = await signup(inviterEmail, 'verystrongpassword123');
    userIdsToCleanup.push(inviter.userId);
    const inviterCookie = extractSessionCookie(inviter.cookie);

    // Capture inviter's org id.
    const inviterMember = await db
      .select()
      .from(schema.orgMembers)
      .where(sql`user_id = ${inviter.userId}`);
    const inviterOrgId = inviterMember[0]!.orgId;
    orgIdsToCleanup.push(inviterOrgId);

    // Create invite.
    const createRes = await fetch(`${baseUrl}/api/orgs/me/invitations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: inviterCookie },
      body: JSON.stringify({ email: inviteeEmail, role: 'member' }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      id: string;
      email: string;
      token: string;
      acceptUrl: string;
    };
    expect(created.email).toBe(inviteeEmail);
    expect(created.token).toBeTruthy();

    // List shows it pending.
    const listRes = await fetch(`${baseUrl}/api/orgs/me/invitations`, {
      headers: { Cookie: inviterCookie },
    });
    const list = (await listRes.json()) as Array<{ email: string; acceptedAt: string | null }>;
    expect(list.find((i) => i.email === inviteeEmail && i.acceptedAt === null)).toBeTruthy();

    // Invitee signs up (gets their own personal org first).
    const invitee = await signup(inviteeEmail, 'verystrongpassword123');
    userIdsToCleanup.push(invitee.userId);
    const inviteeCookie = extractSessionCookie(invitee.cookie);
    const inviteePersonal = await db
      .select()
      .from(schema.orgMembers)
      .where(sql`user_id = ${invitee.userId}`);
    expect(inviteePersonal).toHaveLength(1);
    orgIdsToCleanup.push(inviteePersonal[0]!.orgId);

    // Invitee accepts.
    const acceptRes = await fetch(`${baseUrl}/api/invitations/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: inviteeCookie },
      body: JSON.stringify({ token: created.token }),
    });
    expect(acceptRes.status).toBe(200);
    const accepted = (await acceptRes.json()) as { orgId: string; role: string };
    expect(accepted.orgId).toBe(inviterOrgId);
    expect(accepted.role).toBe('member');

    // Invitee now has 2 memberships.
    const inviteeMemberships = await db
      .select()
      .from(schema.orgMembers)
      .where(sql`user_id = ${invitee.userId}`);
    expect(inviteeMemberships).toHaveLength(2);

    // Inviter's members list shows both users.
    const membersRes = await fetch(`${baseUrl}/api/orgs/me/members`, {
      headers: { Cookie: inviterCookie },
    });
    expect(membersRes.status).toBe(200);
    const members = (await membersRes.json()) as Array<{ email: string; role: string }>;
    const emails = members.map((m) => m.email);
    expect(emails).toContain(inviterEmail);
    expect(emails).toContain(inviteeEmail);

    // Re-accepting the same token fails (already accepted).
    const replay = await fetch(`${baseUrl}/api/invitations/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: inviteeCookie },
      body: JSON.stringify({ token: created.token }),
    });
    expect(replay.status).toBe(409);
  }, 30_000);

  it('email-mismatch on invite acceptance is rejected', async () => {
    const ts = Date.now();
    const inviter = await signup(`mm-inviter-${ts}@example.com`, 'verystrongpassword123');
    userIdsToCleanup.push(inviter.userId);
    const inviterCookie = extractSessionCookie(inviter.cookie);
    const inviterOrgRows = await db
      .select()
      .from(schema.orgMembers)
      .where(sql`user_id = ${inviter.userId}`);
    orgIdsToCleanup.push(inviterOrgRows[0]!.orgId);

    const createRes = await fetch(`${baseUrl}/api/orgs/me/invitations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: inviterCookie },
      body: JSON.stringify({ email: `expected-${ts}@example.com`, role: 'member' }),
    });
    const created = (await createRes.json()) as { token: string };

    const wrongUser = await signup(`wrong-${ts}@example.com`, 'verystrongpassword123');
    userIdsToCleanup.push(wrongUser.userId);
    const wrongUserMember = await db
      .select()
      .from(schema.orgMembers)
      .where(sql`user_id = ${wrongUser.userId}`);
    orgIdsToCleanup.push(wrongUserMember[0]!.orgId);

    const acceptRes = await fetch(`${baseUrl}/api/invitations/accept`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Cookie: extractSessionCookie(wrongUser.cookie),
      },
      body: JSON.stringify({ token: created.token }),
    });
    expect(acceptRes.status).toBe(403);
  }, 30_000);

  it('sole owner cannot demote or remove themselves', async () => {
    const ts = Date.now();
    const owner = await signup(`sole-${ts}@example.com`, 'verystrongpassword123');
    userIdsToCleanup.push(owner.userId);
    const cookie = extractSessionCookie(owner.cookie);
    const ownerOrg = await db
      .select()
      .from(schema.orgMembers)
      .where(sql`user_id = ${owner.userId}`);
    orgIdsToCleanup.push(ownerOrg[0]!.orgId);

    const demote = await fetch(`${baseUrl}/api/orgs/me/members/${owner.userId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ role: 'member' }),
    });
    expect(demote.status).toBe(409);

    const removed = await fetch(`${baseUrl}/api/orgs/me/members/${owner.userId}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(removed.status).toBe(409);
  }, 30_000);
});
