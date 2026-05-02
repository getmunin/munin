import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
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
  ConversationClaimsService,
  ClaimedByOtherError,
} from '../modules/conv/conv.claims.service.js';
import {
  ConvService,
  ConvInvalidError,
  HandoverActiveError,
  STATUSES,
  type ConversationDetail,
  type ConversationSummary,
  type MessageDto,
} from '../modules/conv/conv.service.js';

const StatusSchema = z.enum(STATUSES);

const ReplyBody = z.object({
  body: z.string().min(1).max(50_000),
  internal: z.boolean().optional(),
  inReplyToId: z.string().optional(),
});

const AssignBody = z.object({
  assigneeUserId: z.string().nullable(),
});

const StatusBody = z.object({
  status: StatusSchema,
  snoozeUntil: z.string().datetime().optional(),
});

const HandoverBody = z
  .object({
    reason: z.string().max(500).optional(),
  })
  .partial();

const TakeOverBody = z
  .object({
    ttlMinutes: z.number().int().positive().max(240).optional(),
  })
  .partial();

interface ConversationListResponse {
  items: ConversationSummary[];
  nextCursor: string | null;
}

interface ConversationDetailResponse extends ConversationDetail {
  claim: { userId: string; expiresAt: string } | null;
}

@Controller('api/conversations')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class ConversationsController {
  constructor(
    private readonly conv: ConvService,
    private readonly claims: ConversationClaimsService,
  ) {}

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('assigneeUserId') assigneeUserId?: string,
    @Query('topicId') topicId?: string,
    @Query('needsHumanAttention') needsHumanAttention?: string,
    @Query('limit') limit?: string,
  ): Promise<ConversationListResponse> {
    const parsedStatus = status ? StatusSchema.safeParse(status) : null;
    if (parsedStatus && !parsedStatus.success) {
      throw new BadRequestException(`invalid status: ${status}`);
    }
    const items = await translate(() =>
      this.conv.listConversations({
        status: parsedStatus?.success ? parsedStatus.data : undefined,
        assigneeUserId,
        topicId,
        needsHumanAttention: parseBool(needsHumanAttention),
        limit: parseLimit(limit),
      }),
    );
    return { items, nextCursor: null };
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<ConversationDetailResponse> {
    const detail = await translate(() => this.conv.getConversation(id));
    const claim = await this.claims.getActiveClaim(id);
    return {
      ...detail,
      claim: claim ? { userId: claim.userId, expiresAt: claim.expiresAt } : null,
    };
  }

  @Post(':id/messages')
  @HttpCode(201)
  async reply(@Param('id') id: string, @Body() body: unknown): Promise<MessageDto> {
    const parsed = ReplyBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    return translate(() =>
      this.conv.sendMessage({
        conversationId: id,
        body: parsed.data.body,
        internal: parsed.data.internal,
        inReplyToId: parsed.data.inReplyToId,
        authorType: actor.type === 'user' ? 'user' : 'agent',
        authorId: actor.id,
      }),
    );
  }

  @Post(':id/assign')
  @HttpCode(200)
  async assign(@Param('id') id: string, @Body() body: unknown): Promise<ConversationSummary> {
    const parsed = AssignBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return translate(() =>
      this.conv.assignConversation({ id, assigneeUserId: parsed.data.assigneeUserId }),
    );
  }

  @Post(':id/status')
  @HttpCode(200)
  async status(@Param('id') id: string, @Body() body: unknown): Promise<ConversationSummary> {
    const parsed = StatusBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return translate(() => this.conv.changeStatus({ id, ...parsed.data }));
  }

  @Post(':id/take-over')
  @HttpCode(200)
  async takeOver(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ userId: string; expiresAt: string }> {
    const parsed = TakeOverBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    const ttlMs = parsed.data.ttlMinutes ? parsed.data.ttlMinutes * 60_000 : undefined;
    const claim = await translate(() => this.claims.claim({ conversationId: id, ttlMs }));
    return { userId: claim.userId, expiresAt: claim.expiresAt };
  }

  @Post(':id/release')
  @HttpCode(200)
  async release(@Param('id') id: string): Promise<{ released: boolean }> {
    await translate(() => this.claims.release({ conversationId: id }));
    return { released: true };
  }

  @Post(':id/request-handover')
  @HttpCode(200)
  async requestHandover(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ConversationSummary> {
    const parsed = HandoverBody.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return translate(() =>
      this.conv.requestHandover({ conversationId: id, reason: parsed.data.reason }),
    );
  }
}

async function translate<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ConvInvalidError) throw new BadRequestException(err.message);
    if (err instanceof HandoverActiveError) throw new ConflictException(err.message);
    if (err instanceof ClaimedByOtherError) throw new ConflictException(err.message);
    throw err;
  }
}

function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return undefined;
}

function parseLimit(value: string | undefined): number | undefined {
  const n = value ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(n, 200);
}
