import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../../common/audit/audit.interceptor.ts';
import {
  APP_SCOPES,
  FeedbackForwardFailedError,
  FeedbackNotFoundError,
  FeedbackService,
  type FeedbackOutboxDto,
} from './feedback.service.ts';

const CreateBody = z.object({
  title: z.string().min(3).max(200),
  body: z.string().min(10).max(4000),
  appScope: z.enum(APP_SCOPES).optional(),
  includeOrgName: z.boolean().optional(),
  includeUserName: z.boolean().optional(),
});

@Controller('v1/feedback')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class FeedbackController {
  constructor(private readonly service: FeedbackService) {}

  @Post()
  async create(@Body() raw: unknown): Promise<FeedbackOutboxDto> {
    const parsed = CreateBody.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.service.create(parsed.data);
  }

  @Post(':id/approve')
  @UseGuards(ControlPlaneGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async approve(@Param('id') id: string): Promise<void> {
    try {
      await this.service.approve(id);
    } catch (err) {
      if (err instanceof FeedbackNotFoundError) {
        throw new NotFoundException(err.message);
      }
      if (err instanceof FeedbackForwardFailedError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  @Post(':id/reject')
  @UseGuards(ControlPlaneGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async reject(@Param('id') id: string): Promise<void> {
    try {
      await this.service.reject(id);
    } catch (err) {
      if (err instanceof FeedbackNotFoundError) throw new NotFoundException(err.message);
      throw err;
    }
  }
}
