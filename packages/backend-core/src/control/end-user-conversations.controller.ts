import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import { getCurrentContext } from '@getmunin/core';
import { AuthGuard } from '../common/auth/auth.guard.js';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.js';
import { AuditInterceptor } from '../common/audit/audit.interceptor.js';
import {
  ConvInvalidError,
  ConvService,
  HandoverActiveError,
  STATUSES,
  type ConversationDetail,
  type ConversationSummary,
  type MessageDto,
} from '../modules/conv/conv.service.js';

const StatusSchema = z.enum(STATUSES);

const StartBody = z.object({
  body: z.string().min(1).max(50_000),
  subject: z.string().max(300).optional(),
  channelHint: z.enum(['email', 'voice', 'chat', 'sms']).optional(),
});

const ReplyBody = z.object({
  body: z.string().min(1).max(50_000),
});

interface ConversationListResponse {
  items: ConversationSummary[];
  nextCursor: string | null;
}

@Controller('api/v1/end-users/me/conversations')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class EndUserConversationsController {
  constructor(private readonly conv: ConvService) {}

  @Post()
  @HttpCode(201)
  async start(@Body() body: unknown): Promise<ConversationDetail> {
    const parsed = StartBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    const actor = this.requireEndUserActor();
    const channel =
      (await this.conv.firstActiveChannel(parsed.data.channelHint ?? 'chat')) ??
      (await this.conv.firstActiveChannel());
    if (!channel) {
      throw new BadRequestException(
        'no active channel configured for this org; ask an admin to create one (e.g. type=chat)',
      );
    }
    return translate(() =>
      this.conv.createConversation({
        channelId: channel.id,
        body: parsed.data.body,
        subject: parsed.data.subject,
        endUserId: actor.endUserId,
        authorType: 'end_user',
        authorId: actor.endUserId,
      }),
    );
  }

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<ConversationListResponse> {
    this.requireEndUserActor();
    const parsedStatus = status ? StatusSchema.safeParse(status) : null;
    if (parsedStatus && !parsedStatus.success) {
      throw new BadRequestException(`invalid status: ${status}`);
    }
    const decodedCursor = cursor ? decodeListCursor(cursor) : undefined;
    const page = await translate(() =>
      this.conv.listConversationsPage({
        status: parsedStatus?.success ? parsedStatus.data : undefined,
        limit: parseLimit(limit),
        cursor: decodedCursor,
      }),
    );
    return {
      items: page.items,
      nextCursor: page.nextCursor ? encodeListCursor(page.nextCursor) : null,
    };
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<ConversationDetail> {
    this.requireEndUserActor();
    return translate(() => this.conv.getConversation(id));
  }

  @Post(':id/messages')
  @HttpCode(201)
  async reply(@Param('id') id: string, @Body() body: unknown): Promise<MessageDto> {
    const parsed = ReplyBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    const actor = this.requireEndUserActor();
    return translate(() =>
      this.conv.sendMessage({
        conversationId: id,
        body: parsed.data.body,
        internal: false,
        authorType: 'end_user',
        authorId: actor.endUserId,
      }),
    );
  }

  private requireEndUserActor(): { endUserId: string; orgId: string } {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (actor.type !== 'end_user_agent' || !actor.endUserId) {
      throw new ForbiddenException('end-user delegated token required for this endpoint');
    }
    return { endUserId: actor.endUserId, orgId: actor.orgId };
  }
}

async function translate<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ConvInvalidError) throw new BadRequestException(err.message);
    if (err instanceof HandoverActiveError) throw new ConflictException(err.message);
    throw err;
  }
}

function parseLimit(value: string | undefined): number | undefined {
  const n = value ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(n, 50);
}

function encodeListCursor(c: { lastMessageAt: string | null; id: string }): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

function decodeListCursor(raw: string): { lastMessageAt: string | null; id: string } | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString());
    if (!parsed || typeof parsed !== 'object') return undefined;
    const candidate = parsed as { id?: unknown; lastMessageAt?: unknown };
    if (typeof candidate.id !== 'string') return undefined;
    if (candidate.lastMessageAt !== null && typeof candidate.lastMessageAt !== 'string')
      return undefined;
    return { lastMessageAt: candidate.lastMessageAt, id: candidate.id };
  } catch {
    return undefined;
  }
}
