import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import {
  KbService,
  KbConflictError,
  KbCurationDecidedError,
  KbInvalidError,
  KbNotFoundError,
  type CurationCandidateDto,
  type CurationCandidateSummary,
  type CurationDecisionDto,
  type DocumentDto,
  type SpaceDto,
} from '../modules/kb/kb.service.ts';

class PublishCandidateBody extends createZodDto(
  z.object({
    targetSpaceSlug: z.string().min(1),
    ifVersion: z.number().int().nonnegative(),
    audiences: z.array(z.string().min(1)).optional(),
  }),
) {}
class PublishRevisionBody extends createZodDto(
  z.object({
    ifCandidateVersion: z.number().int().nonnegative(),
    ifDocumentVersion: z.number().int().nonnegative(),
  }),
) {}
class UpdateCandidateBody extends createZodDto(
  z.object({
    title: z.string().min(1).optional(),
    body: z.string().min(1).optional(),
  }),
) {}
class DismissCandidateBody extends createZodDto(
  z.object({
    ifVersion: z.number().int().nonnegative().optional(),
    reason: z.string().min(1).max(500).optional(),
  }),
) {}

interface CandidateListResponse {
  items: CurationCandidateSummary[];
}

@Controller('v1/kb/curation/candidates')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class KbCandidatesController {
  constructor(private readonly kb: KbService) {}

  @Get()
  async list(): Promise<CandidateListResponse> {
    const items = await this.kb.listCurationCandidates();
    return { items };
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<CurationCandidateDto> {
    return translate(() => this.kb.getCurationCandidate(id));
  }

  @Patch(':id')
  @HttpCode(200)
  async update(
    @Param('id') id: string,
    @Body() input: UpdateCandidateBody,
  ): Promise<CurationCandidateDto> {
    return translate(async () => {
      const existing = await this.kb.getCurationCandidate(id);
      await this.kb.updateDocument({
        id,
        ifVersion: existing.version,
        title: input.title,
        body: input.body,
      });
      return this.kb.getCurationCandidate(id);
    });
  }

  @Post(':id/publish')
  @HttpCode(200)
  async publish(
    @Param('id') id: string,
    @Body() input: PublishCandidateBody,
  ): Promise<DocumentDto> {
    return translate(() =>
      this.kb.publishCurationCandidate({
        candidateDocumentId: id,
        targetSpaceSlug: input.targetSpaceSlug,
        ifVersion: input.ifVersion,
        audiences: input.audiences,
      }),
    );
  }

  @Post(':id/publish-revision')
  @HttpCode(200)
  async publishRevision(
    @Param('id') id: string,
    @Body() input: PublishRevisionBody,
  ): Promise<DocumentDto> {
    return translate(() =>
      this.kb.publishCurationRevision({
        candidateDocumentId: id,
        ifCandidateVersion: input.ifCandidateVersion,
        ifDocumentVersion: input.ifDocumentVersion,
      }),
    );
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  async dismiss(
    @Param('id') id: string,
    @Body() input: DismissCandidateBody,
  ): Promise<{ dismissed: true }> {
    const doc = await translate(() => this.kb.getDocument(id));
    await translate(() =>
      this.kb.dismissCurationCandidate({
        id,
        ifVersion: input.ifVersion ?? doc.version,
        reason: input.reason,
      }),
    );
    return { dismissed: true };
  }
}

@Controller('v1/kb/spaces')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class KbSpacesController {
  constructor(private readonly kb: KbService) {}

  @Get()
  async list(): Promise<SpaceDto[]> {
    return this.kb.listSpaces();
  }
}

@Controller('v1/kb/curation/decisions')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class KbCurationDecisionsController {
  constructor(private readonly kb: KbService) {}

  @Get()
  async list(
    @Query('outcome') outcome?: string,
    @Query('limit') limit?: string,
  ): Promise<{ items: CurationDecisionDto[] }> {
    const parsedOutcome =
      outcome === 'published' || outcome === 'dismissed' ? outcome : undefined;
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    const items = await translate(() =>
      this.kb.listCurationDecisions({
        outcome: parsedOutcome,
        limit: Number.isFinite(parsedLimit) && parsedLimit! > 0 ? parsedLimit : undefined,
      }),
    );
    return { items };
  }
}

async function translate<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof KbConflictError) {
      throw new ConflictException({ message: err.message, code: err.code });
    }
    if (err instanceof KbCurationDecidedError) {
      throw new ConflictException({ message: err.message, code: err.code });
    }
    if (err instanceof KbInvalidError) throw new BadRequestException(err.message);
    if (err instanceof KbNotFoundError) throw new BadRequestException(err.message);
    throw err;
  }
}
