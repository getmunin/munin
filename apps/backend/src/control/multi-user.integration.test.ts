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

  /**
   * Force-switch a user's default membership to the given org. There's no API
   * for this yet (`/api/orgs/me/*` always resolves to `is_default = true`),
   * but several auth-matrix tests need to act as a non-owner of org B while
   * holding only a session cookie.
   */
  async function setDefaultOrg(userId: string, orgId: string): Promise<void> {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db
      .update(schema.orgMembers)
      .set({ isDefault: false })
      .where(sql`user_id = ${userId}`);
    await db
      .update(schema.orgMembers)
      .set({ isDefault: true })
      .where(sql`user_id = ${userId} AND org_id = ${orgId}`);
  }

  /** End-to-end: invite an email into ownerCookie's org, sign up the invitee, accept. */
  async function inviteAndAccept(args: {
    inviterCookie: string;
    inviterOrgId: string;
    inviteeEmail: string;
    role?: 'owner' | 'member';
  }): Promise<{ inviteeUserId: string; inviteeCookie: string }> {
    const createRes = await fetch(`${baseUrl}/api/orgs/me/invitations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: args.inviterCookie },
      body: JSON.stringify({ email: args.inviteeEmail, role: args.role ?? 'member' }),
    });
    expect(createRes.status).toBe(201);
    const { token } = (await createRes.json()) as { token: string };
    const invitee = await signup(args.inviteeEmail, 'verystrongpassword123');
    userIdsToCleanup.push(invitee.userId);
    const personal = await db
      .select({ orgId: schema.orgMembers.orgId })
      .from(schema.orgMembers)
      .where(sql`user_id = ${invitee.userId}`);
    if (personal[0]) orgIdsToCleanup.push(personal[0].orgId);
    const inviteeCookie = extractSessionCookie(invitee.cookie);
    const acceptRes = await fetch(`${baseUrl}/api/invitations/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: inviteeCookie },
      body: JSON.stringify({ token }),
    });
    expect(acceptRes.status).toBe(200);
    return { inviteeUserId: invitee.userId, inviteeCookie };
  }

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

  it('non-owner member cannot create or revoke invitations, or patch/remove members', async () => {
    const ts = Date.now();
    const owner = await signup(`nm-owner-${ts}@example.com`, 'verystrongpassword123');
    userIdsToCleanup.push(owner.userId);
    const ownerCookie = extractSessionCookie(owner.cookie);
    const ownerMembership = await db
      .select()
      .from(schema.orgMembers)
      .where(sql`user_id = ${owner.userId}`);
    const orgId = ownerMembership[0]!.orgId;
    orgIdsToCleanup.push(orgId);

    const { inviteeUserId, inviteeCookie } = await inviteAndAccept({
      inviterCookie: ownerCookie,
      inviterOrgId: orgId,
      inviteeEmail: `nm-member-${ts}@example.com`,
    });

    // Make orgId the member's default so /api/orgs/me/* targets it.
    await setDefaultOrg(inviteeUserId, orgId);

    // Non-owner attempts to invite — must 403.
    const inviteAttempt = await fetch(`${baseUrl}/api/orgs/me/invitations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: inviteeCookie },
      body: JSON.stringify({ email: `outsider-${ts}@example.com`, role: 'member' }),
    });
    expect(inviteAttempt.status).toBe(403);

    // Owner creates a real invite, then the non-owner member tries to revoke it — must 403.
    const inviteRes = await fetch(`${baseUrl}/api/orgs/me/invitations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({ email: `revtarget-${ts}@example.com`, role: 'member' }),
    });
    const invite = (await inviteRes.json()) as { id: string };
    const revokeAttempt = await fetch(`${baseUrl}/api/orgs/me/invitations/${invite.id}`, {
      method: 'DELETE',
      headers: { Cookie: inviteeCookie },
    });
    expect(revokeAttempt.status).toBe(403);

    // Non-owner tries to patch the owner's role — must 403.
    const patchAttempt = await fetch(`${baseUrl}/api/orgs/me/members/${owner.userId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', Cookie: inviteeCookie },
      body: JSON.stringify({ role: 'member' }),
    });
    expect(patchAttempt.status).toBe(403);

    // Non-owner tries to delete the owner — must 403.
    const removeAttempt = await fetch(`${baseUrl}/api/orgs/me/members/${owner.userId}`, {
      method: 'DELETE',
      headers: { Cookie: inviteeCookie },
    });
    expect(removeAttempt.status).toBe(403);
  }, 30_000);

  it('cross-tenant: owner of A cannot patch/remove members of B; cannot revoke B\'s invites', async () => {
    const ts = Date.now();
    const ownerA = await signup(`xta-${ts}@example.com`, 'verystrongpassword123');
    const ownerB = await signup(`xtb-${ts}@example.com`, 'verystrongpassword123');
    userIdsToCleanup.push(ownerA.userId, ownerB.userId);
    const cookieA = extractSessionCookie(ownerA.cookie);
    const cookieB = extractSessionCookie(ownerB.cookie);

    const aMembership = await db
      .select()
      .from(schema.orgMembers)
      .where(sql`user_id = ${ownerA.userId}`);
    const bMembership = await db
      .select()
      .from(schema.orgMembers)
      .where(sql`user_id = ${ownerB.userId}`);
    orgIdsToCleanup.push(aMembership[0]!.orgId, bMembership[0]!.orgId);

    // A targets B's user via /api/orgs/me/members — A's session resolves to A,
    // so the userId from B simply doesn't exist in A's members → 404. There
    // is no path-based way to address a foreign org.
    const patch = await fetch(`${baseUrl}/api/orgs/me/members/${ownerB.userId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ role: 'member' }),
    });
    expect(patch.status).toBe(404);

    const del = await fetch(`${baseUrl}/api/orgs/me/members/${ownerB.userId}`, {
      method: 'DELETE',
      headers: { Cookie: cookieA },
    });
    expect(del.status).toBe(404);

    // B creates an invite; A tries to revoke it by id — must 404 (RLS hides the row from A's tx).
    const inv = await fetch(`${baseUrl}/api/orgs/me/invitations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: cookieB },
      body: JSON.stringify({ email: `xt-target-${ts}@example.com`, role: 'member' }),
    });
    const created = (await inv.json()) as { id: string };
    const revoke = await fetch(`${baseUrl}/api/orgs/me/invitations/${created.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookieA },
    });
    expect(revoke.status).toBe(404);

    // For symmetry, A's members list does not include B's user.
    const list = await fetch(`${baseUrl}/api/orgs/me/members`, { headers: { Cookie: cookieA } });
    const members = (await list.json()) as Array<{ userId: string }>;
    expect(members.find((m) => m.userId === ownerB.userId)).toBeFalsy();
  }, 30_000);

  it('removed member: session no longer resolves against the org they were removed from', async () => {
    const ts = Date.now();
    const owner = await signup(`rm-owner-${ts}@example.com`, 'verystrongpassword123');
    userIdsToCleanup.push(owner.userId);
    const ownerCookie = extractSessionCookie(owner.cookie);
    const ownerMembership = await db
      .select()
      .from(schema.orgMembers)
      .where(sql`user_id = ${owner.userId}`);
    const orgId = ownerMembership[0]!.orgId;
    orgIdsToCleanup.push(orgId);

    const { inviteeUserId, inviteeCookie } = await inviteAndAccept({
      inviterCookie: ownerCookie,
      inviterOrgId: orgId,
      inviteeEmail: `rm-member-${ts}@example.com`,
    });
    await setDefaultOrg(inviteeUserId, orgId);

    // Confirm the member's session resolves to orgId before removal and
    // that they see both members in the list.
    const beforeMe = await fetch(`${baseUrl}/api/orgs/me`, { headers: { Cookie: inviteeCookie } });
    expect(beforeMe.status).toBe(200);
    expect(((await beforeMe.json()) as { id: string }).id).toBe(orgId);

    // Owner removes the member.
    const remove = await fetch(`${baseUrl}/api/orgs/me/members/${inviteeUserId}`, {
      method: 'DELETE',
      headers: { Cookie: ownerCookie },
    });
    expect(remove.status).toBe(204);

    // After removal: the member's session must not resolve to orgId anymore.
    // Their personal org becomes the fallback (no membership in orgId means
    // the credential resolver picks any remaining membership).
    const afterMe = await fetch(`${baseUrl}/api/orgs/me`, { headers: { Cookie: inviteeCookie } });
    expect(afterMe.status).toBe(200);
    const afterOrg = (await afterMe.json()) as { id: string };
    expect(afterOrg.id).not.toBe(orgId);

    // And from the owner's perspective, the removed user is no longer in the
    // members list of orgId.
    const ownerMembers = await fetch(`${baseUrl}/api/orgs/me/members`, {
      headers: { Cookie: ownerCookie },
    });
    const list = (await ownerMembers.json()) as Array<{ userId: string }>;
    expect(list.find((m) => m.userId === inviteeUserId)).toBeFalsy();
  }, 30_000);

  it('admin surfaces reject anonymous and bogus bearer with 401', async () => {
    // No auth at all on session-only routes.
    const meAnon = await fetch(`${baseUrl}/api/orgs/me`);
    expect(meAnon.status).toBe(401);

    // /api/orgs/me/members / invitations are session-or-bearer but require auth.
    const membersAnon = await fetch(`${baseUrl}/api/orgs/me/members`);
    expect(membersAnon.status).toBe(401);
    const invitesAnon = await fetch(`${baseUrl}/api/orgs/me/invitations`);
    expect(invitesAnon.status).toBe(401);

    // /mcp without auth.
    const mcpAnon = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(mcpAnon.status).toBe(401);

    // /api/partner/orgs without auth.
    const partnerAnon = await fetch(`${baseUrl}/api/partner/orgs`);
    expect(partnerAnon.status).toBe(401);

    // Bogus bearer token on /mcp — 401.
    const mcpBogus = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer mn_admin_garbage' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(mcpBogus.status).toBe(401);
  }, 30_000);
});
