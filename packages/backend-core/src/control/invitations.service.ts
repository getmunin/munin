import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { schema, type Db } from '@getmunin/db';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  getCurrentContext,
  hashSecret,
  randomToken,
  type Mailer,
} from '@getmunin/core';
import { renderOrgInviteEmail } from '@getmunin/emails';
import { DB } from '../common/db/db.module.ts';
import { MAILER } from '../common/mail/mail.module.ts';
import { assertOwner, assertOwnerOrAdmin, VALID_ROLES } from './role-guard.ts';

const INVITE_TTL_DAYS = 7;

export interface InvitationDto {
  id: string;
  orgId: string;
  email: string;
  role: string;
  invitedByUserId: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedByUserId: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreatedInvitation extends InvitationDto {
  token: string;
  acceptUrl: string;
  mailerConfigured: boolean;
}

@Injectable()
export class InvitationsService {
  constructor(
    @Inject(DB) private readonly serviceDb: Db,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  /** Issued by an owner via the dashboard's session-cookie path. */
  async create(input: { email: string; role?: string }): Promise<CreatedInvitation> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (actor.type !== 'user') {
      throw new ForbiddenException('only signed-in users can create invitations');
    }
    await assertOwner(actor.orgId, actor.userId ?? actor.id);

    const role = input.role ?? 'member';
    if (!VALID_ROLES.has(role)) {
      throw new BadRequestException(`invalid role: ${role}`);
    }
    const email = input.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new BadRequestException('invalid email');
    }

    // Already a member?
    const existingMember = await ctx.db
      .select({ userId: schema.orgMembers.userId })
      .from(schema.orgMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.orgMembers.userId))
      .where(and(eq(schema.orgMembers.orgId, actor.orgId), eq(schema.users.email, email)))
      .limit(1);
    if (existingMember[0]) {
      throw new ConflictException(`${email} is already a member of this org`);
    }

    // Existing pending invite for the same email? Revoke it; re-issue.
    await ctx.db
      .update(schema.orgInvitations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.orgInvitations.orgId, actor.orgId),
          eq(schema.orgInvitations.email, email),
          isNull(schema.orgInvitations.acceptedAt),
          isNull(schema.orgInvitations.revokedAt),
        ),
      );

    const token = randomToken(24);
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const [row] = await ctx.db
      .insert(schema.orgInvitations)
      .values({
        orgId: actor.orgId,
        email,
        role,
        tokenHash: hashSecret(token),
        invitedByUserId: actor.userId ?? actor.id,
        expiresAt,
      })
      .returning();

    const acceptUrl = await this.buildAcceptUrl(token);
    await this.sendInviteEmail(email, acceptUrl, actor.orgId, actor.userId ?? null);

    return {
      ...toDto(row!),
      token,
      acceptUrl,
      mailerConfigured: this.mailer.name !== 'stub',
    };
  }

  async listPending(): Promise<InvitationDto[]> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    await assertOwnerOrAdmin(actor.orgId, actor.userId ?? actor.id);
    const rows = await ctx.db
      .select()
      .from(schema.orgInvitations)
      .where(
        and(
          eq(schema.orgInvitations.orgId, ctx.actor!.orgId),
          isNull(schema.orgInvitations.acceptedAt),
          isNull(schema.orgInvitations.revokedAt),
        ),
      )
      .orderBy(asc(schema.orgInvitations.createdAt));
    return rows.map(toDto);
  }

  async revoke(invitationId: string): Promise<{ revoked: true }> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    await assertOwner(actor.orgId, actor.userId ?? actor.id);
    const result = await ctx.db
      .update(schema.orgInvitations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.orgInvitations.id, invitationId),
          eq(schema.orgInvitations.orgId, actor.orgId),
          isNull(schema.orgInvitations.acceptedAt),
        ),
      )
      .returning({ id: schema.orgInvitations.id });
    if (result.length === 0) throw new NotFoundException(`invitation ${invitationId} not found`);
    return { revoked: true };
  }

  /**
   * Accept an invite. Service-role-DB path: the invitee isn't a member of
   * the target org yet, so RLS would reject. We bypass RLS and validate by
   * matching the supplied token's hash against an unaccepted, unrevoked,
   * unexpired row.
   */
  async lookupByToken(token: string): Promise<{ email: string; role: string; expiresAt: string } | null> {
    if (!token) return null;
    const tokenHash = hashSecret(token);
    const rows = await this.serviceDb
      .select({
        email: schema.orgInvitations.email,
        role: schema.orgInvitations.role,
        expiresAt: schema.orgInvitations.expiresAt,
        acceptedAt: schema.orgInvitations.acceptedAt,
        revokedAt: schema.orgInvitations.revokedAt,
      })
      .from(schema.orgInvitations)
      .where(eq(schema.orgInvitations.tokenHash, tokenHash))
      .limit(1);
    const inv = rows[0];
    if (!inv) return null;
    if (inv.acceptedAt || inv.revokedAt || inv.expiresAt.getTime() < Date.now()) return null;
    return { email: inv.email, role: inv.role, expiresAt: inv.expiresAt.toISOString() };
  }

  async accept(input: { token: string; userId: string }): Promise<{ orgId: string; role: string }> {
    if (!input.token || !input.userId) {
      throw new BadRequestException('token and userId required');
    }
    const tokenHash = hashSecret(input.token);
    const rows = await this.serviceDb
      .select()
      .from(schema.orgInvitations)
      .where(eq(schema.orgInvitations.tokenHash, tokenHash))
      .limit(1);
    const invitation = rows[0];
    if (!invitation) throw new NotFoundException('Invitation not found.');
    if (invitation.acceptedAt) {
      throw new ConflictException('This invitation has already been accepted.');
    }
    if (invitation.revokedAt) {
      throw new GoneException('This invitation has been revoked.');
    }
    if (invitation.expiresAt.getTime() < Date.now()) {
      throw new GoneException('This invitation has expired.');
    }

    const userRows = await this.serviceDb
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, input.userId))
      .limit(1);
    if (!userRows[0]) throw new NotFoundException('Signed-in user not found.');

    await this.serviceDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      // Insert membership; if already a member, no-op via ON CONFLICT.
      await tx
        .insert(schema.orgMembers)
        .values({
          orgId: invitation.orgId,
          userId: input.userId,
          role: invitation.role,
        })
        .onConflictDoNothing();
      await tx
        .update(schema.orgInvitations)
        .set({ acceptedAt: new Date(), acceptedByUserId: input.userId })
        .where(eq(schema.orgInvitations.id, invitation.id));
    });
    return { orgId: invitation.orgId, role: invitation.role };
  }

  // ─── helpers ─────────────────────────────────────────────────────────

  private buildAcceptUrl(token: string): Promise<string> {
    const webBase = (process.env.MUNIN_WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
    return Promise.resolve(`${webBase}/accept-invite?token=${encodeURIComponent(token)}`);
  }

  private async sendInviteEmail(
    email: string,
    acceptUrl: string,
    orgId: string,
    inviterUserId: string | null,
  ): Promise<void> {
    const ctx = getCurrentContext();
    const orgRows = await ctx.db
      .select({ name: schema.orgs.name })
      .from(schema.orgs)
      .where(eq(schema.orgs.id, orgId))
      .limit(1);
    const orgName = orgRows[0]?.name ?? 'a Munin org';
    let inviterName: string | null = null;
    if (inviterUserId) {
      const userRows = await ctx.db
        .select({ name: schema.users.name, email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, inviterUserId))
        .limit(1);
      inviterName = userRows[0]?.name?.trim() || userRows[0]?.email || null;
    }
    try {
      const tpl = await renderOrgInviteEmail({ acceptUrl, orgName, inviterName });
      await this.mailer.send({
        to: email,
        subject: tpl.subject,
        text: tpl.text,
        html: tpl.html,
      });
    } catch {
      // Send failures must not block invite creation — the inviter sees the
      // accept URL in the API response and can resend manually.
    }
  }
}

function toDto(row: typeof schema.orgInvitations.$inferSelect): InvitationDto {
  return {
    id: row.id,
    orgId: row.orgId,
    email: row.email,
    role: row.role,
    invitedByUserId: row.invitedByUserId,
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    acceptedByUserId: row.acceptedByUserId,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
