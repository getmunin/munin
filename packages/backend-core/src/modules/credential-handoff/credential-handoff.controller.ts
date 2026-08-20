import { BadRequestException, Body, Get, Post, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PublicController } from '../../common/auth/auth.guard.ts';
import {
  CredentialHandoffService,
  type CredentialLink,
  type PendingCredentialDto,
} from './credential-handoff.service.ts';
import type { CredentialApplyResult } from './credential-target.ts';

const DescribeQuery = z.object({ token: z.string().min(1).max(128) });

class CompleteCredentialHandoffBody extends createZodDto(
  z.object({
    token: z.string().min(1).max(128),
    secrets: z.record(z.string(), z.string().min(1)),
  }),
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
  complete(@Body() input: CompleteCredentialHandoffBody): Promise<CredentialApplyResult> {
    return this.handoff.complete(input.token, input.secrets);
  }
}

export type { CredentialLink };
