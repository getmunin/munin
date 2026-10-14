import { BadRequestException, Body, Get, Post, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PublicController } from '../../common/auth/auth.guard.ts';
import {
  CredentialHandoffService,
  type CredentialLink,
  type CredentialSubmitResult,
  type PendingCredentialDto,
} from './credential-handoff.service.ts';

const DescribeQuery = z.object({ token: z.string().min(1).max(128) });

class CompleteCredentialHandoffBody extends createZodDto(
  z.object({
    token: z.string().min(1).max(128),
    secrets: z.record(z.string(), z.string().min(1)),
  }),
) {}

class RetestCredentialHandoffBody extends createZodDto(
  z.object({ token: z.string().min(1).max(128) }),
) {}

@PublicController('v1/credentials', { throttle: true })
export class CredentialHandoffController {
  constructor(private readonly handoff: CredentialHandoffService) {}

  @Get()
  describe(@Query() query: unknown): Promise<PendingCredentialDto> {
    const parsed = DescribeQuery.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.handoff.describe(parsed.data.token);
  }

  @Post()
  complete(@Body() input: CompleteCredentialHandoffBody): Promise<CredentialSubmitResult> {
    return this.handoff.complete(input.token, input.secrets);
  }

  @Post('retest')
  retest(@Body() input: RetestCredentialHandoffBody): Promise<CredentialSubmitResult> {
    return this.handoff.retest(input.token);
  }
}

export type { CredentialLink };
