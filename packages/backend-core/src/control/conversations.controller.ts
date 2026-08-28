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
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { getCurrentContext } from '@getmunin/core';
import { MessageComponentsSchema } from '@getmunin/types';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import {
  ConversationClaimsService,
  ClaimedByOtherError,
} from '../modules/conv/conv.claims.service.ts';
import {
  ConvService,
  ConvInvalidError,
  AgentReplyRaceError,
  AGENT_MODES,
  HandoverActiveError,
  STATUSES,
  type ConversationDetail,
  type ConversationQueueItem,
  type ConversationSummary,
  type MessageDto,
} from '../modules/conv/conv.service.ts';

const StatusSchema = z.enum(STATUSES);
const AgentModeSchema = z.enum(AGENT_MODES);

class SetAgentModeBody extends createZodDto(z.object({ mode: AgentModeSchema })) {}

class SendReplyBody extends createZodDto(
  z.object({
    body: z.string().min(1).max(50_000),
    internal: z.boolean().optional(),
    inReplyToId: z.string().optional(),
    preserveAttention: z.boolean().optional(),
    sinceMessageId: z.string().optional(),
    claim: z.boolean().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
    components: MessageComponentsSchema.optional(),
    fromDraftId: z.string().min(1).max(64).optional(),
  }),
) {}

class RunnerClaimBody extends createZodDto(
  z.object({
    holder: z.string().min(1).max(128),
    leaseSeconds: z.number().int().min(30).max(86_400).optional(),
  }),
) {}

class RunnerReleaseBody extends createZodDto(
  z.object({
    holder: z.string().min(1).max(128),
  }),
) {}

class AssignConversationBody extends createZodDto(
  z.object({
    assigneeUserId: z.string().nullable(),
  }),
) {}

class ChangeStatusBody extends createZodDto(
  z.object({
    status: StatusSchema,
    snoozeUntil: z.string().datetime().optional(),
  }),
) {}

class RequestHandoverBody extends createZodDto(
  z
    .object({
      reason: z.string().max(500).optional(),
      publicFallbackMessage: z.string().max(2000).optional(),
    })
    .partial(),
) {}

class SetDraftReplyBody extends createZodDto(
  z.object({
    body: z.string().min(1).max(50_000),
    retrievedDocumentIds: z.array(z.string().min(1).max(64)).max(8).optional(),
  }),
) {}

class SetTopicBody extends createZodDto(
  z.object({
    topicId: z.string().nullable(),
  }),
) {}

class TakeOverBody extends createZodDto(
  z
    .object({
      ttlMinutes: z.number().int().positive().max(240).optional(),
    })
    .partial(),
) {}

interface ConversationListResponse {
  items: ConversationSummary[];
  nextCursor: string | null;
}

interface ConversationQueueResponse {
  items: ConversationQueueItem[];
  nextCursor: string | null;
}

interface ConversationDetailResponse extends ConversationDetail {
  claim: { holderType: 'user'; holderId: string; expiresAt: string } | null;
}

@Controller('v1/conversations')
@UseGuards(AuthGuard, ControlPlaneGuard)
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
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<ConversationListResponse> {
    const parsedStatus = status ? StatusSchema.safeParse(status) : null;
    if (parsedStatus && !parsedStatus.success) {
      throw new BadRequestException(`invalid status: ${status}`);
    }
    const decodedCursor = cursor ? decodeListCursor(cursor) : undefined;
    const page = await translate(() =>
      this.conv.listConversationsPage({
        status: parsedStatus?.success ? parsedStatus.data : undefined,
        assigneeUserId,
        topicId,
        needsHumanAttention: parseBool(needsHumanAttention),
        limit: parseLimit(limit),
        cursor: decodedCursor,
      }),
    );
    return {
      items: page.items,
      nextCursor: page.nextCursor ? encodeListCursor(page.nextCursor) : null,
    };
  }

  @Get('queue')
  async queue(
    @Query('status') status?: string,
    @Query('assigneeUserId') assigneeUserId?: string,
    @Query('topicId') topicId?: string,
    @Query('needsHumanAttention') needsHumanAttention?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<ConversationQueueResponse> {
    const parsedStatus = status ? StatusSchema.safeParse(status) : null;
    if (parsedStatus && !parsedStatus.success) {
      throw new BadRequestException(`invalid status: ${status}`);
    }
    const decodedCursor = cursor ? decodeListCursor(cursor) : undefined;
    const page = await translate(() =>
      this.conv.listConversationQueuePage({
        status: parsedStatus?.success ? parsedStatus.data : undefined,
        assigneeUserId,
        topicId,
        needsHumanAttention: parseBool(needsHumanAttention),
        limit: parseLimit(limit),
        cursor: decodedCursor,
      }),
    );
    return {
      items: page.items,
      nextCursor: page.nextCursor ? encodeListCursor(page.nextCursor) : null,
    };
  }

  @Get('topics')
  async listTopics(): Promise<Array<{ id: string; slug: string; name: string; color: string | null }>> {
    return translate(() => this.conv.listTopics());
  }

  @Get('awaiting-reply')
  async awaitingReply(
    @Query('limit') limit?: string,
    @Query('lookbackMinutes') lookbackMinutes?: string,
  ): Promise<{ items: Array<{ id: string }> }> {
    const items = await translate(() =>
      this.conv.listConversationsAwaitingAgentReply({
        limit: parseLimit(limit),
        lookbackMinutes: parsePositiveInt(lookbackMinutes),
      }),
    );
    return { items };
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<ConversationDetailResponse> {
    const detail = await translate(() => this.conv.getConversation(id));
    const claim = await this.claims.getActiveClaim(id);
    return {
      ...detail,
      claim: claim
        ? { holderType: claim.holderType, holderId: claim.holderId, expiresAt: claim.expiresAt }
        : null,
    };
  }

  @Post(':id/messages')
  @HttpCode(201)
  async reply(@Param('id') id: string, @Body() input: SendReplyBody): Promise<MessageDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (input.totalTokens != null) ctx.aiTokens = input.totalTokens;
    return translate(() =>
      this.conv.sendMessage({
        conversationId: id,
        body: input.body,
        internal: input.internal,
        inReplyToId: input.inReplyToId,
        preserveAttention: input.preserveAttention,
        sinceMessageId: input.sinceMessageId,
        claim: input.claim,
        components: input.components,
        fromDraftId: input.fromDraftId,
        authorType: actor.type === 'user' ? 'user' : 'agent',
        authorId: actor.id,
      }),
    );
  }

  @Post(':id/runner-claim')
  @HttpCode(200)
  async runnerClaim(
    @Param('id') id: string,
    @Body() input: RunnerClaimBody,
  ): Promise<{ acquired: boolean; leaseExpiresAt?: string; heldBy?: string | null }> {
    return translate(() =>
      this.conv.tryAcquireConversation({
        conversationId: id,
        holder: input.holder,
        leaseSeconds: input.leaseSeconds ?? 3600,
      }),
    );
  }

  @Post(':id/runner-release')
  @HttpCode(200)
  async runnerRelease(
    @Param('id') id: string,
    @Body() input: RunnerReleaseBody,
  ): Promise<{ released: boolean }> {
    return translate(() =>
      this.conv.releaseConversationClaim({ conversationId: id, holder: input.holder }),
    );
  }

  @Post(':id/assign')
  @HttpCode(200)
  async assign(
    @Param('id') id: string,
    @Body() input: AssignConversationBody,
  ): Promise<ConversationSummary> {
    return translate(() =>
      this.conv.assignConversation({ id, assigneeUserId: input.assigneeUserId }),
    );
  }

  @Post(':id/status')
  @HttpCode(200)
  async status(
    @Param('id') id: string,
    @Body() input: ChangeStatusBody,
  ): Promise<ConversationSummary> {
    return translate(async () => {
      if (input.status === 'closed') {
        await this.claims.release({ conversationId: id, force: true });
      }
      return this.conv.changeStatus({ id, ...input });
    });
  }

  @Post(':id/agent-mode')
  @HttpCode(200)
  async agentMode(
    @Param('id') id: string,
    @Body() input: SetAgentModeBody,
  ): Promise<ConversationSummary> {
    return translate(() => this.conv.setAgentMode({ id, mode: input.mode }));
  }

  @Post(':id/take-over')
  @HttpCode(200)
  async takeOver(
    @Param('id') id: string,
    @Body() input: TakeOverBody,
  ): Promise<{ holderType: 'user'; holderId: string; expiresAt: string }> {
    const ttlMs = input.ttlMinutes ? input.ttlMinutes * 60_000 : undefined;
    const claim = await translate(() => this.claims.claim({ conversationId: id, ttlMs }));
    return { holderType: claim.holderType, holderId: claim.holderId, expiresAt: claim.expiresAt };
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
    @Body() input: RequestHandoverBody,
  ): Promise<ConversationSummary> {
    return translate(() =>
      this.conv.requestHandover({
        conversationId: id,
        reason: input.reason,
        publicFallbackMessage: input.publicFallbackMessage,
      }),
    );
  }

  @Post(':id/draft-reply')
  @HttpCode(200)
  async setDraftReply(
    @Param('id') id: string,
    @Body() input: SetDraftReplyBody,
  ): Promise<{ id: string }> {
    return translate(() =>
      this.conv.setDraftReply({
        conversationId: id,
        body: input.body,
        retrievedDocumentIds: input.retrievedDocumentIds,
      }),
    );
  }

  @Post(':id/clear-draft')
  @HttpCode(200)
  async clearDraft(@Param('id') id: string): Promise<{ cleared: number }> {
    return translate(() => this.conv.clearDraftReply(id));
  }

  @Post(':id/request-draft')
  @HttpCode(202)
  async requestDraft(@Param('id') id: string): Promise<{ requested: boolean }> {
    return translate(() => this.conv.requestDraft(id));
  }

  @Post(':id/topic')
  @HttpCode(200)
  async setTopic(
    @Param('id') id: string,
    @Body() input: SetTopicBody,
  ): Promise<ConversationSummary> {
    return translate(() =>
      this.conv.setTopic({ conversationId: id, topicId: input.topicId }),
    );
  }
}

async function translate<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ConvInvalidError) throw new BadRequestException(err.message);
    if (err instanceof HandoverActiveError) {
      throw new ConflictException({ message: err.message, code: err.code });
    }
    if (err instanceof ClaimedByOtherError) {
      throw new ConflictException({ message: err.message, code: err.code });
    }
    if (err instanceof AgentReplyRaceError) {
      throw new ConflictException({ message: err.message, code: err.code });
    }
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

function parsePositiveInt(value: string | undefined): number | undefined {
  const n = value ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
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
    if (candidate.lastMessageAt !== null && typeof candidate.lastMessageAt !== 'string') return undefined;
    return { lastMessageAt: candidate.lastMessageAt, id: candidate.id };
  } catch {
    return undefined;
  }
}
