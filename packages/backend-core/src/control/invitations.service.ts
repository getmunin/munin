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
import { DB } from '../common/db/db.module.js';
import { MAILER } from '../common/mail/mail.module.js';

const INVITE_TTL_DAYS = 7;
const VALID_ROLES = new Set(['owner', 'member']);

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
  /** Returned only at creation time. The plaintext token. */
  token: string;
  acceptUrl: string;
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
    await this.assertOwner(actor.orgId, actor.userId ?? actor.id);

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
    await this.sendInviteEmail(email, acceptUrl, actor.orgId);

    return { ...toDto(row!), token, acceptUrl };
  }

  async listPending(): Promise<InvitationDto[]> {
    const ctx = getCurrentContext();
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
    await this.assertOwner(actor.orgId, actor.userId ?? actor.id);
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
    if (!invitation) throw new NotFoundException('invitation_not_found');
    if (invitation.acceptedAt) throw new ConflictException('invitation_already_accepted');
    if (invitation.revokedAt) throw new GoneException('invitation_revoked');
    if (invitation.expiresAt.getTime() < Date.now()) {
      throw new GoneException('invitation_expired');
    }

    // Verify the accepting user's email matches the invite (defense against
    // someone clicking another person's link).
    const userRows = await this.serviceDb
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, input.userId))
      .limit(1);
    const user = userRows[0];
    if (!user) throw new NotFoundException('user_not_found');
    if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new ForbiddenException('invitation_email_mismatch');
    }

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

  private async assertOwner(orgId: string, userId: string): Promise<void> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ role: schema.orgMembers.role })
      .from(schema.orgMembers)
      .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.userId, userId)))
      .limit(1);
    if (rows[0]?.role !== 'owner') {
      throw new ForbiddenException('only org owners can manage invitations and members');
    }
  }

  private buildAcceptUrl(token: string): Promise<string> {
    const webBase = (process.env.MUNIN_WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
    return Promise.resolve(`${webBase}/accept-invite?token=${encodeURIComponent(token)}`);
  }

  private async sendInviteEmail(email: string, acceptUrl: string, orgId: string): Promise<void> {
    const ctx = getCurrentContext();
    const orgRows = await ctx.db
      .select({ name: schema.orgs.name })
      .from(schema.orgs)
      .where(eq(schema.orgs.id, orgId))
      .limit(1);
    const orgName = orgRows[0]?.name ?? 'a Munin org';
    try {
      await this.mailer.send({
        to: email,
        subject: `You've been invited to ${orgName} on Munin`,
        text: [
          `You've been invited to join ${orgName} on Munin.`,
          '',
          `Accept the invitation by signing in or signing up at:`,
          acceptUrl,
          '',
          'The link is valid for 7 days. If you weren\'t expecting this invite, you can ignore this email.',
        ].join('\n'),
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
