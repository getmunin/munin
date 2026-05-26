import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { InvitationsService } from './invitations.service.ts';

const CreateInviteDto = z.object({
  email: z.string().email(),
  role: z.enum(['owner', 'admin', 'member']).optional(),
});

@Controller('v1/orgs/me/invitations')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class InvitationsController {
  constructor(@Inject(InvitationsService) private readonly invites: InvitationsService) {}

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown) {
    const parsed = CreateInviteDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.invites.create(parsed.data);
  }

  @Get()
  list() {
    return this.invites.listPending();
  }

  @Delete(':id')
  @HttpCode(200)
  revoke(@Param('id') id: string) {
    return this.invites.revoke(id);
  }
}
