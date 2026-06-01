import {
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
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { RoleGuard } from './role.guard.ts';
import { RequireActorType, RequireRole } from './role.decorator.ts';
import { InvitationsService } from './invitations.service.ts';

class CreateInviteBody extends createZodDto(
  z.object({
    email: z.string().email(),
    role: z.enum(['owner', 'admin', 'member']).optional(),
  }),
) {}

@Controller('v1/orgs/me/invitations')
@UseGuards(AuthGuard, ControlPlaneGuard, RoleGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class InvitationsController {
  constructor(@Inject(InvitationsService) private readonly invites: InvitationsService) {}

  @Post()
  @HttpCode(201)
  @RequireActorType('user')
  @RequireRole('owner')
  async create(@Body() input: CreateInviteBody) {
    return this.invites.create(input);
  }

  @Get()
  @RequireRole('owner', 'admin')
  list() {
    return this.invites.listPending();
  }

  @Delete(':id')
  @HttpCode(200)
  @RequireRole('owner')
  revoke(@Param('id') id: string) {
    return this.invites.revoke(id);
  }
}
